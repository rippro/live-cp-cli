import type { CompareMode } from "./types.js";

export function compareOutput(actual: string, expected: string, mode: CompareMode): boolean {
  switch (mode) {
    case "trimmed-exact":
      return actual.trim() === expected.trim();
  }
}
