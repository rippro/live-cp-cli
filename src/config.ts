import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

import type { JudgeConfig, Language, LanguageCommands } from "./types.js";

const DEFAULT_API_BASE_URL = "https://live-cp-web.vercel.app";
const CONFIG_PATH = ".rippro-judge.json";

export function loadConfig(): JudgeConfig {
  const fileConfig = readConfigFile();
  const apiBaseUrl = fileConfig.apiBaseUrl ?? DEFAULT_API_BASE_URL;
  const eventId = fileConfig.eventId;
  const token = fileConfig.token;

  if (!eventId) {
    throw new Error("eventId is required in .rippro-judge.json.");
  }
  if (!token) {
    throw new Error("token is required in .rippro-judge.json.");
  }

  return {
    apiBaseUrl: apiBaseUrl.replace(/\/+$/, ""),
    eventId,
    token,
  };
}

function readConfigFile(): Partial<JudgeConfig> {
  const path = resolve(CONFIG_PATH);
  if (!existsSync(path)) {
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

  const languageCommands = readOptionalLanguageCommands(raw);
  if (languageCommands !== undefined) {
    config.languageCommands = languageCommands;
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

const VALID_LANGUAGES = new Set<string>([
  "c", "cpp", "go", "haskell", "java", "javascript",
  "kotlin", "perl", "php", "python", "ruby", "rust",
]);

function readOptionalLanguageCommands(
  record: Record<string, unknown>,
): LanguageCommands | undefined {
  const value = record["languageCommands"];
  if (value === undefined) {
    return undefined;
  }
  if (!isRecord(value)) {
    throw new Error("languageCommands in config file must be a JSON object");
  }
  const result: LanguageCommands = {};
  for (const [lang, cmd] of Object.entries(value)) {
    if (!VALID_LANGUAGES.has(lang)) {
      throw new Error(`languageCommands: unknown language "${lang}"`);
    }
    if (typeof cmd !== "string" || cmd.length === 0) {
      throw new Error(`languageCommands.${lang} must be a non-empty string`);
    }
    result[lang as Language] = cmd;
  }
  return result;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
