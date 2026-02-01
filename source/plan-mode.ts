import path from "path";
import { randomUUID } from "crypto";
import { Transport } from "./transports/transport-common.ts";
import * as logger from "./logger.ts";

/** Directory where plan files are stored (relative to project root) */
const PLAN_DIR = ".plans";
/** Length of unique ID appended to plan filenames (6 chars = ~16 million combinations) */
const ID_LENGTH = 6;
/** Error message for empty git branch (triggers fallback to cwd) */
const EMPTY_BRANCH_ERROR = "Empty branch name";

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

function shouldFallbackToCwd(e: unknown): boolean {
  return isExpectedGitError(e) || (e instanceof Error && e.message === EMPTY_BRANCH_ERROR);
}

function buildPlanPath(name: string): string {
  const sanitized = name.replace(/[^a-zA-Z0-9_-]/g, "-");
  const uniqueId = generateUniqueId();
  return path.join(PLAN_DIR, `${sanitized}-${uniqueId}.md`);
}

/**
 * Generates a plan file path based on the current git branch or current working directory.
 *
 * First attempts to get the git branch name. If git is not available or fails,
 * falls back to using the current working directory name.
 *
 * @param transport - The transport interface for file system operations
 * @param signal - Abort signal for cancellation
 * @returns The plan file path (e.g., ".plans/my-branch-abc123.md")
 * @throws {Error} Non-git errors that shouldn't trigger fallback
 * @throws {Error} If fallback operations (cwd, basename) also fail
 */
export async function getPlanFilePath(transport: Transport, signal: AbortSignal): Promise<string> {
  try {
    const branch = await transport.shell(signal, "git branch --show-current", 5000);
    const trimmed = branch.trim();
    if (!trimmed) {
      throw new Error(EMPTY_BRANCH_ERROR);
    }
    return buildPlanPath(trimmed);
  } catch (e) {
    if (!shouldFallbackToCwd(e)) throw e;

    // Fallback: use current directory name, with proper error handling
    try {
      const cwd = await transport.cwd(signal);
      const dirname = path.basename(cwd);
      if (!dirname) {
        throw new Error("Failed to derive a valid path from current directory");
      }
      return buildPlanPath(dirname);
    } catch (fallbackErr) {
      const errorMessage = fallbackErr instanceof Error ? fallbackErr.message : String(fallbackErr);
      const originalErrorMessage = e instanceof Error ? e.message : String(e);
      logger.error("info", "getPlanFilePath fallback operation failed", {
        originalError: originalErrorMessage,
        fallbackError: errorMessage,
      });
      throw new Error(
        `Failed to determine plan file path: git error (${originalErrorMessage}), fallback also failed (${errorMessage})`,
      );
    }
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

/**
 * Initializes a plan file by creating the directory structure and template.
 *
 * Creates the .plans directory if it doesn't exist, and creates a new plan file
 * with the default template if the specified file doesn't exist.
 *
 * @param transport - The transport interface for file system operations
 * @param filePath - The full path to the plan file to initialize
 * @param signal - Abort signal for cancellation
 * @throws {Error} If directory creation fails (insufficient permissions, disk full, etc.)
 * @throws {Error} If file existence check fails
 * @throws {Error} If template file creation fails
 */
export async function initializePlanFile(
  transport: Transport,
  filePath: string,
  signal: AbortSignal,
): Promise<void> {
  try {
    await transport.mkdir(signal, PLAN_DIR);
    logger.log("verbose", "Plan directory created/verified", { planDir: PLAN_DIR });
  } catch (mkdirErr) {
    const errorMessage = mkdirErr instanceof Error ? mkdirErr.message : String(mkdirErr);
    logger.error("info", "Failed to create plans directory", {
      planDir: PLAN_DIR,
      error: errorMessage,
    });
    throw new Error(`Failed to create plans directory (${PLAN_DIR}): ${errorMessage}`);
  }

  let exists = false;
  try {
    exists = await transport.pathExists(signal, filePath);
  } catch (pathCheckErr) {
    const errorMessage =
      pathCheckErr instanceof Error ? pathCheckErr.message : String(pathCheckErr);
    logger.error("info", "Failed to check plan file existence", { filePath, error: errorMessage });
    throw new Error(`Failed to check if plan file exists (${filePath}): ${errorMessage}`);
  }

  if (!exists) {
    try {
      await transport.writeFile(signal, filePath, PLAN_TEMPLATE);
      logger.log("info", "Plan file created with template", { filePath });
    } catch (writeErr) {
      const errorMessage = writeErr instanceof Error ? writeErr.message : String(writeErr);
      logger.error("info", "Failed to write plan template file", { filePath, error: errorMessage });
      throw new Error(`Failed to create plan file template (${filePath}): ${errorMessage}`);
    }
  }
}
