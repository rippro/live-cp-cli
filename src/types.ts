export type Language = "cpp" | "python";
export type JudgeStatus = "AC" | "WA" | "TLE" | "RE" | "CE" | "IE";
export type CompareMode = "trimmed-exact";

export interface JudgeConfig {
  apiBaseUrl: string;
  eventId: string;
  token: string;
}

export interface ProblemConfig {
  eventId: string;
  id: string;
  title: string;
  statement: string;
  timeLimitMs: number;
  compareMode: CompareMode;
}

export interface Testcase {
  id: string;
  input: string;
  expectedOutput: string;
  orderIndex: number;
}

export interface TestcasesResponse {
  cases: Testcase[];
}

export interface CaseResult {
  caseId: string;
  status: JudgeStatus;
  timeMs: number;
}

export interface AcceptedCaseResult {
  caseId: string;
  status: "AC";
  timeMs: number;
}

export interface SubmissionResponse {
  submissionId: string;
  solved: boolean;
  solvedAt: string;
}

export interface RunResult {
  status: JudgeStatus;
  stdout: string;
  stderr: string;
  timeMs: number;
}
