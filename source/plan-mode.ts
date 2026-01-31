import path from "path";
import { randomUUID } from "crypto";
import { Transport } from "./transports/transport-common.ts";

const PLAN_DIR = ".plans";
const ID_LENGTH = 6;

function generateUniqueId(): string {
  return randomUUID().replace(/-/g, "").slice(0, ID_LENGTH);
}

const EXPECTED_GIT_ERROR_PATTERNS: (string | RegExp)[] = [
  "fatal: not a git repository",
  "fatal: unable to read",
  "git: command not found",
  /git.*exit code \d+/i,
];

function isExpectedGitError(e: unknown): boolean {
  const msg = e instanceof Error ? e.message : String(e);
  return EXPECTED_GIT_ERROR_PATTERNS.some(p => {
    if (typeof p === "string") {
      return msg.toLowerCase().includes(p.toLowerCase());
    }
    return p.test(msg);
  });
}

export async function getPlanFilePath(transport: Transport, signal: AbortSignal): Promise<string> {
  try {
    const branch = await transport.shell(signal, "git branch --show-current", 5000);
    const trimmed = branch.trim();
    // Handle detached HEAD or other cases where branch name is empty
    if (!trimmed) {
      throw new Error("Empty branch name");
    }
    const sanitized = trimmed.replace(/[^a-zA-Z0-9_-]/g, "-");
    const uniqueId = generateUniqueId();
    return path.join(PLAN_DIR, `${sanitized}-${uniqueId}.md`);
  } catch (e) {
    if (!isExpectedGitError(e) && !(e instanceof Error && e.message === "Empty branch name"))
      throw e;
    const cwd = await transport.cwd(signal);
    const dirName = path.basename(cwd);
    const sanitized = dirName.replace(/[^a-zA-Z0-9_-]/g, "-");
    const uniqueId = generateUniqueId();
    return path.join(PLAN_DIR, `${sanitized}-${uniqueId}.md`);
  }
}

const PLAN_TEMPLATE = `# Implementation Plan

## Goal
[Your task description here]

## Exploration
[Agent will fill in findings from codebase analysis]

## Implementation Steps
1. [Step 1]
2. [Step 2]
3. [Step 3]

## Files to Modify
- [file path]: [description of changes]

## Notes
[Any additional notes or considerations]
`;

export async function initializePlanFile(
  transport: Transport,
  filePath: string,
  signal: AbortSignal,
): Promise<void> {
  await transport.mkdir(signal, PLAN_DIR);

  const exists = await transport.pathExists(signal, filePath);
  if (!exists) {
    await transport.writeFile(signal, filePath, PLAN_TEMPLATE);
  }
}
