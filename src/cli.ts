#!/usr/bin/env node
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { createInterface } from "node:readline/promises";
import { resolve } from "node:path";
import { stdin as input, stdout as output } from "node:process";

import { getProblemConfig, getTestcases, submitAccepted } from "./api.js";
import { compareOutput } from "./compare.js";
import { loadConfig } from "./config.js";
import { sha256Hex } from "./hash.js";
import { detectLanguage, languageCommandName } from "./language.js";
import { prepareRunner } from "./runner.js";
import type { CaseResult, JudgeStatus, Testcase } from "./types.js";

interface ParsedArgs {
  command: string | null;
  problemId: string | null;
  sourcePath: string | null;
  apiBaseUrl?: string;
  eventId?: string;
  token?: string;
  configPath?: string;
  force: boolean;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  if (args.command === "help" || args.command === null) {
    printHelp();
    process.exit(args.command === null ? 1 : 0);
  }
  if (args.command === "init") {
    await initConfig(args);
    return;
  }
  if (args.command !== "submit") {
    throw new Error(`unknown command: ${args.command}`);
  }
  if (!args.problemId || !args.sourcePath) {
    throw new Error("submit requires <problemId> and <sourcePath>");
  }

  const sourcePath = resolve(args.sourcePath);
  if (!existsSync(sourcePath)) {
    throw new Error(`source file not found: ${sourcePath}`);
  }

  const config = loadConfig(args);
  const problem = await getProblemConfig(config, args.problemId);
  const language = detectLanguage(sourcePath);

  if (!language) {
    throw new Error("unsupported source extension. Use .cpp, .cc, .cxx, or .py.");
  }
  if (!problem.allowedLanguages.includes(language)) {
    throw new Error(
      `${language} is not allowed for ${problem.id}. allowed: ${problem.allowedLanguages.join(", ")}`,
    );
  }

  console.log(`Problem: ${problem.id} ${problem.title}`);
  console.log(`Language: ${language} (${languageCommandName(language)})`);
  console.log(`Testcase version: ${problem.testcaseVersion}`);

  const testcases = await getTestcases(config, args.problemId, problem.testcaseVersion);
  const source = readFileSync(sourcePath);
  const runner = await prepareRunner(sourcePath, language);

  try {
    const results: CaseResult[] = [];
    let maxTimeMs = 0;

    for (const testcase of testcases.cases) {
      const result = await runner.run(testcase.input, problem.timeLimitMs);
      const status = judgeCaseStatus(result.status, result.stdout, testcase.expectedOutput);
      maxTimeMs = Math.max(maxTimeMs, result.timeMs);
      results.push({ caseId: testcase.id, status, timeMs: result.timeMs });
      printCaseResult(testcase, status, result.timeMs);

      if (status !== "AC") {
        printFailure(testcase, result.stdout, result.stderr, status);
        console.log("Result: NOT AC. No submission was sent to the server.");
        process.exit(1);
      }
    }

    const submission = await submitAccepted(config, args.problemId, {
      language,
      sourceHash: sha256Hex(source),
      testcaseVersion: problem.testcaseVersion,
      maxTimeMs,
      cases: results,
    });

    console.log(
      `Result: AC. submissionId=${submission.submissionId} firstSolve=${String(
        submission.solved,
      )} solvedAt=${submission.solvedAt}`,
    );
  } finally {
    await runner.cleanup();
  }
}

async function initConfig(args: ParsedArgs): Promise<void> {
  const configPath = resolve(args.configPath ?? ".rippro-judge.json");
  if (existsSync(configPath) && !args.force) {
    throw new Error(`config file already exists: ${configPath}. Use --force to overwrite.`);
  }

  const interactive = process.stdin.isTTY && process.stdout.isTTY;
  let eventId = args.eventId;
  let token = args.token;

  if (interactive && (!eventId || !token)) {
    const rl = createInterface({ input, output });
    try {
      eventId = eventId ?? (await askRequired(rl, "Event ID"));
      token = token ?? (await askRequired(rl, "CLI token"));
    } finally {
      rl.close();
    }
  }

  if (!eventId) {
    throw new Error("eventId is required. Use --event or run init in an interactive terminal.");
  }
  if (!token) {
    throw new Error("token is required. Use --token or run init in an interactive terminal.");
  }

  const config: Record<string, string> = { eventId, token };
  if (args.apiBaseUrl) {
    config.apiBaseUrl = args.apiBaseUrl.replace(/\/+$/, "");
  }
  writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`, { mode: 0o600 });
  console.log(`Wrote ${configPath}`);
}

async function askRequired(
  rl: ReturnType<typeof createInterface>,
  label: string,
): Promise<string> {
  while (true) {
    const answer = (await rl.question(`${label}: `)).trim();
    if (answer) {
      return answer;
    }
    console.log(`${label} is required.`);
  }
}

function judgeCaseStatus(
  runStatus: JudgeStatus,
  stdout: string,
  expectedOutput: string,
): JudgeStatus {
  if (runStatus !== "AC") {
    return runStatus;
  }
  return compareOutput(stdout, expectedOutput, "trimmed-exact") ? "AC" : "WA";
}

function printCaseResult(testcase: Testcase, status: JudgeStatus, timeMs: number): void {
  const label = `${testcase.orderIndex.toString().padStart(2, "0")} ${testcase.type}`;
  console.log(`[${status}] ${label} ${timeMs}ms`);
}

function printFailure(
  testcase: Testcase,
  actualOutput: string,
  stderr: string,
  status: JudgeStatus,
): void {
  if (status === "RE" || status === "CE" || status === "IE") {
    console.error(stderr.trim() || "(no stderr)");
  }
  if (!testcase.showOnFailure) {
    console.log("This testcase is hidden.");
    return;
  }

  console.log("Input:");
  console.log(testcase.input.trimEnd());
  console.log("Expected:");
  console.log(testcase.expectedOutput.trimEnd());
  console.log("Actual:");
  console.log(actualOutput.trimEnd());
}

function parseArgs(argv: string[]): ParsedArgs {
  const parsed: ParsedArgs = {
    command: argv[0] ?? null,
    problemId: null,
    sourcePath: null,
    force: false,
  };
  const positional: string[] = [];

  for (let index = 1; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === undefined) {
      continue;
    }
    if (!arg.startsWith("--")) {
      positional.push(arg);
      continue;
    }
    if (arg === "--force") {
      parsed.force = true;
      continue;
    }

    const value = argv[index + 1];
    if (!value || value.startsWith("--")) {
      throw new Error(`${arg} requires a value`);
    }
    index += 1;

    switch (arg) {
      case "--api":
        parsed.apiBaseUrl = value;
        break;
      case "--event":
        parsed.eventId = value;
        break;
      case "--token":
        parsed.token = value;
        break;
      case "--config":
        parsed.configPath = value;
        break;
      default:
        throw new Error(`unknown option: ${arg}`);
    }
  }

  parsed.problemId = positional[0] ?? null;
  parsed.sourcePath = positional[1] ?? null;
  return parsed;
}

function printHelp(): void {
  console.log(`Usage:
  rj init [--event <eventId>] [--token <token>] [--config <path>] [--force]
  rj submit <problemId> <sourcePath> [--event <eventId>] [--token <token>]

Config:
  Reads --config, ./.rippro-judge.json, ~/.rippro-judge/config.json, or RJ_* env vars.
  Required: eventId, token. API URL is embedded in this package.
  Override with --api <url> or RJ_API_BASE_URL for local development.
`);
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`Error: ${message}`);
  process.exit(1);
});
