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

export function errorToString(error: unknown): string {
  if(error instanceof Error) return error.message;
  if(typeof error === 'string') return error;

  if(typeof error === 'object' && error !== null) {
    // Try to extract message from error object
    const errorObj = error as Record<string, unknown>;
    if ('message' in errorObj && typeof errorObj['message'] === 'string') {
      return errorObj["message"];
    }
    if ('error' in errorObj && typeof errorObj['error'] === 'string') {
      return errorObj["error"];
    }
    if ('reason' in errorObj && typeof errorObj['reason'] === 'string') {
      return errorObj["reason"];
    }
    // Fallback: stringify the object
    return JSON.stringify(errorObj);
  }

  if(typeof error === 'number' || typeof error === 'boolean') return String(error);

  // Fallback for null/undefined/everything else
  return String(error);
}