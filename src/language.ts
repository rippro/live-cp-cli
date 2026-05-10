import { extname } from "node:path";

import type { Language } from "./types.js";

export function detectLanguage(sourcePath: string): Language | null {
  switch (extname(sourcePath).toLowerCase()) {
    case ".cc":
    case ".cpp":
    case ".cxx":
      return "cpp";
    case ".py":
      return "python";
    default:
      return null;
  }
}

export function languageCommandName(language: Language): string {
  switch (language) {
    case "cpp":
      return "g++";
    case "python":
      return "python3";
  }
}
