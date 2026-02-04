import path from "path";
import { randomUUID } from "crypto";
import { Transport } from "./transports/transport-common.ts";
import * as logger from "./logger.ts";
import {
  isGitNotRepositoryError,
  isFileNotFoundError,
  isPermissionError,
  isAbortError,
} from "./errors.ts";

/** Directory where plan files are stored (relative to transport working directory) */
const PLAN_DIR = ".plans";
/** Length of unique ID appended to plan filenames (6 hex chars = 16,777,216 combinations) */
const ID_LENGTH = 6;
function generateUniqueId(): string {
  return randomUUID().replace(/-/g, "").slice(0, ID_LENGTH);
}

function buildPlanPath(name: string): string {
  const sanitized = name.replace(/[^a-zA-Z0-9_-]/g, "-");
  const uniqueId = generateUniqueId();
  return path.join(PLAN_DIR, `${sanitized}-${uniqueId}.md`);
}

export async function getPlanFilePath(transport: Transport, signal: AbortSignal): Promise<string> {
  let branchName: string | null = null;
  try {
    const branch = await transport.shell(signal, "git branch --show-current", 5000);
    const trimmed = branch.trim();
    if (trimmed) branchName = trimmed;
  } catch (err) {
    if (signal.aborted || isAbortError(err)) throw err;
    if (!isGitNotRepositoryError(err)) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error("info", "Unexpected error during git branch detection", { error: message });
    }
    const message = err instanceof Error ? err.message : String(err);
    logger.log("verbose", "Git branch detection failed, falling back to cwd", { error: message });
  }

  if (!branchName) {
    try {
      const cwdPath = await transport.cwd(signal);
      branchName = path.basename(cwdPath);
    } catch (err) {
      if (signal.aborted || isAbortError(err)) throw err;
      if (!isFileNotFoundError(err) && !isPermissionError(err)) {
        const message = err instanceof Error ? err.message : String(err);
        logger.error("info", "Unexpected error getting cwd", { error: message });
      }
      const message = err instanceof Error ? err.message : String(err);
      logger.log("verbose", "Failed to get cwd, using fallback branch name", { error: message });
      branchName = "plan";
    }
  }

  return buildPlanPath(branchName);
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
