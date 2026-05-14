import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";

import type { Language, RunResult } from "./types.js";

export interface PreparedRunner {
  run(input: string, timeLimitMs: number): Promise<RunResult>;
  cleanup(): Promise<void>;
}

export async function prepareRunner(
  sourcePath: string,
  language: Language,
): Promise<PreparedRunner> {
  return LANGUAGE_PREPARERS[language](sourcePath);
}

const LANGUAGE_PREPARERS: Record<Language, (sourcePath: string) => Promise<PreparedRunner>> = {
  c: prepareCRunner,
  cpp: prepareCppRunner,
  go: prepareGoRunner,
  haskell: prepareHaskellRunner,
  java: prepareJavaRunner,
  javascript: prepareJavaScriptRunner,
  kotlin: prepareKotlinRunner,
  perl: preparePerlRunner,
  php: preparePhpRunner,
  python: preparePythonRunner,
  ruby: prepareRubyRunner,
  rust: prepareRustRunner,
};

async function prepareCppRunner(sourcePath: string): Promise<PreparedRunner> {
  return prepareCompiledRunner(
    "g++",
    (artifactPath) => ["-std=c++17", "-O2", "-pipe", sourcePath, "-o", artifactPath],
    (artifactPath) => artifactPath,
    (artifactPath) => [artifactPath],
  );
}

async function prepareCRunner(sourcePath: string): Promise<PreparedRunner> {
  return prepareCompiledRunner(
    "gcc",
    (artifactPath) => ["-std=c17", "-O2", "-pipe", sourcePath, "-o", artifactPath],
    (artifactPath) => artifactPath,
    (artifactPath) => [artifactPath],
  );
}

async function prepareGoRunner(sourcePath: string): Promise<PreparedRunner> {
  return prepareCommandRunner("go", ["run", sourcePath]);
}

async function prepareHaskellRunner(sourcePath: string): Promise<PreparedRunner> {
  return prepareCompiledRunner(
    "ghc",
    (artifactPath) => ["-O2", sourcePath, "-o", artifactPath],
    (artifactPath) => artifactPath,
    (artifactPath) => [artifactPath],
  );
}

async function prepareJavaRunner(sourcePath: string): Promise<PreparedRunner> {
  const className = basename(sourcePath, ".java");
  return prepareCompiledRunner(
    "javac",
    (artifactPath) => ["-d", artifactPath, sourcePath],
    (_artifactPath) => "java",
    (artifactPath) => ["-cp", artifactPath, className],
    "",
  );
}

async function prepareJavaScriptRunner(sourcePath: string): Promise<PreparedRunner> {
  return prepareCommandRunner("node", [sourcePath]);
}

async function prepareKotlinRunner(sourcePath: string): Promise<PreparedRunner> {
  return prepareCompiledRunner(
    "kotlinc",
    (artifactPath) => [sourcePath, "-include-runtime", "-d", artifactPath],
    (_artifactPath) => "java",
    (artifactPath) => ["-jar", artifactPath],
    "main.jar",
  );
}

async function preparePerlRunner(sourcePath: string): Promise<PreparedRunner> {
  return prepareCommandRunner("perl", [sourcePath]);
}

async function preparePhpRunner(sourcePath: string): Promise<PreparedRunner> {
  return prepareCommandRunner("php", [sourcePath]);
}

async function preparePythonRunner(sourcePath: string): Promise<PreparedRunner> {
  return prepareCommandRunner("python3", [sourcePath]);
}

async function prepareRubyRunner(sourcePath: string): Promise<PreparedRunner> {
  return prepareCommandRunner("ruby", [sourcePath]);
}

async function prepareRustRunner(sourcePath: string): Promise<PreparedRunner> {
  return prepareCompiledRunner(
    "rustc",
    (artifactPath) => ["-O", sourcePath, "-o", artifactPath],
    (artifactPath) => artifactPath,
    (artifactPath) => [artifactPath],
  );
}

function prepareCommandRunner(command: string, args: string[]): PreparedRunner {
  return {
    run(input, timeLimitMs) {
      return runProcess(command, args, input, timeLimitMs);
    },
    async cleanup() {
      return Promise.resolve();
    },
  };
}

async function prepareCompiledRunner(
  compileCommand: string,
  compileArgs: (artifactPath: string) => string[],
  runCommand: (artifactPath: string) => string,
  runArgs: (artifactPath: string) => string[],
  artifactName = "main",
): Promise<PreparedRunner> {
  const dir = await mkdtemp(join(tmpdir(), "rippro-judge-"));
  const artifactPath = join(dir, artifactName);
  const compile = await runProcess(compileCommand, compileArgs(artifactPath), "", 30_000);
  const compileStatus = compile.status === "RE" ? "CE" : compile.status;

  if (compileStatus !== "AC") {
    return {
      async run() {
        return { ...compile, status: compileStatus };
      },
      async cleanup() {
        await rm(dir, { recursive: true, force: true });
      },
    };
  }

  return {
    run(input, timeLimitMs) {
      return runProcess(runCommand(artifactPath), runArgs(artifactPath), input, timeLimitMs);
    },
    async cleanup() {
      await rm(dir, { recursive: true, force: true });
    },
  };
}

function runProcess(
  command: string,
  args: string[],
  input = "",
  timeoutMs = 30_000,
): Promise<RunResult> {
  const startedAt = performance.now();

  return new Promise((resolve) => {
    const child = spawn(command, args, { stdio: ["pipe", "pipe", "pipe"] });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    let timedOut = false;

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGKILL");
    }, timeoutMs);

    child.stdout.on("data", (chunk: Buffer) => stdout.push(chunk));
    child.stderr.on("data", (chunk: Buffer) => stderr.push(chunk));
    child.on("error", (error) => {
      clearTimeout(timer);
      resolve({
        status: "IE",
        stdout: "",
        stderr: error.message,
        timeMs: elapsedMs(startedAt),
      });
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({
        status: timedOut ? "TLE" : code === 0 ? "AC" : "RE",
        stdout: Buffer.concat(stdout).toString("utf8"),
        stderr: Buffer.concat(stderr).toString("utf8"),
        timeMs: elapsedMs(startedAt),
      });
    });

    child.stdin.end(input);
  });
}

function elapsedMs(startedAt: number): number {
  return Math.max(0, Math.round(performance.now() - startedAt));
}
