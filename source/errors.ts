export class PaymentError extends Error {
  constructor(msg: string) {
    super(msg);
    this.name = this.constructor.name;
  }
}
export class RateLimitError extends Error {
  constructor(msg: string) {
    super(msg);
    this.name = this.constructor.name;
  }
}

export class CompactionRequestError extends Error {
  requestError: string;
  curl: string | null;
  constructor(requestError: string, curl?: string | null) {
    super(requestError);
    this.requestError = requestError;
    this.curl = curl || null;
    this.name = this.constructor.name;
  }
}

export function errorToString(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;

  if (typeof error === "object" && error !== null) {
    // Try to extract message from error object
    const errorObj = error as Record<string, unknown>;
    if ("message" in errorObj && typeof errorObj["message"] === "string") {
      return errorObj["message"];
    }
    if ("error" in errorObj && typeof errorObj["error"] === "string") {
      return errorObj["error"];
    }
    if ("reason" in errorObj && typeof errorObj["reason"] === "string") {
      return errorObj["reason"];
    }
    // Fallback: stringify the object
    return JSON.stringify(errorObj);
  }

  if (typeof error === "number" || typeof error === "boolean") return String(error);

  // Fallback for null/undefined/everything else
  return String(error);
}

/**
 * Checks if an error indicates we're not in a git repository.
 * Used when git commands fail due to missing .git directory.
 */
export function isGitNotRepositoryError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return message.includes("not a git repository") || message.includes("Command failed");
}

/**
 * Checks if an error is a file not found (ENOENT) error.
 */
export function isFileNotFoundError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return message.includes("ENOENT");
}

/**
 * Checks if an error is a permission denied error (EACCES, EPERM, etc).
 */
export function isPermissionError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return (
    message.includes("EACCES") ||
    message.includes("EPERM") ||
    message.includes("permission") ||
    message.includes("Permission")
  );
}

/**
 * Checks if an error is an abort/cancellation error.
 */
export function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.message === "Aborted";
}
