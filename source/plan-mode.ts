import path from "path";
import { randomUUID } from "crypto";
import { Transport } from "./transports/transport-common.ts";
import * as logger from "./logger.ts";

/** Directory where plan files are stored (relative to project root) */
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
    if (signal.aborted) throw err;
    logger.log("verbose", "Git branch detection failed, falling back to cwd", {
      error: err instanceof Error ? err.message : String(err),
    });
  }

  if (!branchName) {
    const cwdPath = await transport.cwd(signal);
    branchName = path.basename(cwdPath);
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
