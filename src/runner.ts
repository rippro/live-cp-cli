import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { Language, RunResult } from "./types.js";

export interface PreparedRunner {
  run(input: string, timeLimitMs: number): Promise<RunResult>;
  cleanup(): Promise<void>;
}

export async function prepareRunner(
  sourcePath: string,
  language: Language,
): Promise<PreparedRunner> {
  switch (language) {
    case "cpp":
      return prepareCppRunner(sourcePath);
    case "python":
      return preparePythonRunner(sourcePath);
  }
}

async function prepareCppRunner(sourcePath: string): Promise<PreparedRunner> {
  const dir = await mkdtemp(join(tmpdir(), "rippro-judge-"));
  const binaryPath = join(dir, "main");
  const compile = await runProcess("g++", [
    "-std=c++17",
    "-O2",
    "-pipe",
    sourcePath,
    "-o",
    binaryPath,
  ]);

  if (compile.status !== "AC") {
    return {
      async run() {
        return { ...compile, status: "CE" };
      },
      async cleanup() {
        await rm(dir, { recursive: true, force: true });
      },
    };
  }

  return {
    run(input, timeLimitMs) {
      return runProcess(binaryPath, [], input, timeLimitMs);
    },
    async cleanup() {
      await rm(dir, { recursive: true, force: true });
    },
  };
}

async function preparePythonRunner(sourcePath: string): Promise<PreparedRunner> {
  return {
    run(input, timeLimitMs) {
      return runProcess("python3", [sourcePath], input, timeLimitMs);
    },
    async cleanup() {
      return Promise.resolve();
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
