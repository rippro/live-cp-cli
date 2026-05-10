import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

import type { JudgeConfig } from "./types.js";

interface CliOptions {
  apiBaseUrl?: string;
  eventId?: string;
  token?: string;
  configPath?: string;
}

export function loadConfig(options: CliOptions): JudgeConfig {
  const fileConfig = readConfigFile(options.configPath);
  const apiBaseUrl =
    options.apiBaseUrl ??
    process.env.RJ_API_BASE_URL ??
    fileConfig.apiBaseUrl ??
    "http://localhost:3000";
  const eventId = options.eventId ?? process.env.RJ_EVENT_ID ?? fileConfig.eventId;
  const token = options.token ?? process.env.RJ_TOKEN ?? fileConfig.token;

  if (!eventId) {
    throw new Error("eventId is required. Use --event, RJ_EVENT_ID, or a config file.");
  }
  if (!token) {
    throw new Error("token is required. Use --token, RJ_TOKEN, or a config file.");
  }

  return {
    apiBaseUrl: apiBaseUrl.replace(/\/+$/, ""),
    eventId,
    token,
  };
}

function readConfigFile(configPath?: string): Partial<JudgeConfig> {
  const candidates = configPath
    ? [resolve(configPath)]
    : [resolve(".rippro-judge.json"), join(homedir(), ".rippro-judge", "config.json")];

  const path = candidates.find((candidate) => existsSync(candidate));
  if (!path) {
    return {};
  }

  const raw = JSON.parse(readFileSync(path, "utf8")) as unknown;
  if (!isRecord(raw)) {
    throw new Error(`config file must contain a JSON object: ${path}`);
  }

  const config: Partial<JudgeConfig> = {};
  const apiBaseUrl = readOptionalString(raw, "apiBaseUrl");
  const eventId = readOptionalString(raw, "eventId");
  const token = readOptionalString(raw, "token");

  if (apiBaseUrl !== undefined) {
    config.apiBaseUrl = apiBaseUrl;
  }
  if (eventId !== undefined) {
    config.eventId = eventId;
  }
  if (token !== undefined) {
    config.token = token;
  }

  return config;
}

function readOptionalString(record: Record<string, unknown>, key: string): string | undefined {
  const value = record[key];
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`${key} in config file must be a non-empty string`);
  }
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
