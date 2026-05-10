import type {
  CaseResult,
  JudgeConfig,
  ProblemConfig,
  SubmissionResponse,
  TestcasesResponse,
} from "./types.js";

export class ApiError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

export async function getProblemConfig(
  config: JudgeConfig,
  problemId: string,
): Promise<ProblemConfig> {
  return requestJson<ProblemConfig>(
    config,
    `/judge/events/${encodeURIComponent(config.eventId)}/problems/${encodeURIComponent(
      problemId,
    )}/config`,
  );
}

export async function getTestcases(
  config: JudgeConfig,
  problemId: string,
  version: string,
): Promise<TestcasesResponse> {
  return requestJson<TestcasesResponse>(
    config,
    `/judge/events/${encodeURIComponent(config.eventId)}/problems/${encodeURIComponent(
      problemId,
    )}/testcases?version=${encodeURIComponent(version)}`,
  );
}

export async function submitAccepted(
  config: JudgeConfig,
  problemId: string,
  input: {
    language: string;
    sourceHash: string;
    testcaseVersion: string;
    maxTimeMs: number;
    cases: CaseResult[];
  },
): Promise<SubmissionResponse> {
  return requestJson<SubmissionResponse>(
    config,
    `/judge/events/${encodeURIComponent(config.eventId)}/problems/${encodeURIComponent(
      problemId,
    )}/submissions`,
    {
      method: "POST",
      body: JSON.stringify({
        ...input,
        status: "AC",
      }),
    },
  );
}

async function requestJson<T>(
  config: JudgeConfig,
  path: string,
  init: RequestInit = {},
): Promise<T> {
  const response = await fetch(`${config.apiBaseUrl}${path}`, {
    ...init,
    headers: {
      authorization: `Bearer ${config.token}`,
      accept: "application/json",
      "content-type": "application/json",
      ...init.headers,
    },
  });

  const text = await response.text();
  const body = text ? (JSON.parse(text) as unknown) : null;

  if (!response.ok) {
    throw new ApiError(response.status, readErrorMessage(body) ?? response.statusText);
  }

  return body as T;
}

function readErrorMessage(body: unknown): string | null {
  if (!isRecord(body)) {
    return null;
  }
  const error = body.error;
  if (!isRecord(error)) {
    return null;
  }
  return typeof error.message === "string" ? error.message : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
