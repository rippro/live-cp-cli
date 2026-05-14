import { extname } from "node:path";

import type { Language } from "./types.js";

interface LanguageSpec {
  extensions: readonly string[];
  commandName: string;
}

const LANGUAGE_SPECS: Record<Language, LanguageSpec> = {
  c: { extensions: [".c"], commandName: "gcc/clang" },
  cpp: { extensions: [".cc", ".cpp", ".cxx"], commandName: "g++/clang++" },
  go: { extensions: [".go"], commandName: "go run" },
  haskell: { extensions: [".hs"], commandName: "ghc" },
  java: { extensions: [".java"], commandName: "javac/java" },
  javascript: { extensions: [".cjs", ".js", ".mjs"], commandName: "node" },
  kotlin: { extensions: [".kt"], commandName: "kotlinc/java" },
  perl: { extensions: [".pl"], commandName: "perl" },
  php: { extensions: [".php"], commandName: "php" },
  python: { extensions: [".py"], commandName: "python3" },
  ruby: { extensions: [".rb"], commandName: "ruby" },
  rust: { extensions: [".rs"], commandName: "rustc" },
};

const EXTENSION_TO_LANGUAGE = new Map<string, Language>();

for (const [language, spec] of Object.entries(LANGUAGE_SPECS) as Array<[Language, LanguageSpec]>) {
  for (const extension of spec.extensions) {
    EXTENSION_TO_LANGUAGE.set(extension, language);
  }
}

export function detectLanguage(sourcePath: string): Language | null {
  return EXTENSION_TO_LANGUAGE.get(extname(sourcePath).toLowerCase()) ?? null;
}

export function languageCommandName(language: Language): string {
  return LANGUAGE_SPECS[language].commandName;
}

export function supportedExtensions(): string[] {
  return [...new Set(Object.values(LANGUAGE_SPECS).flatMap((spec) => spec.extensions))].sort();
}
