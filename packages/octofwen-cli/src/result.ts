export type Result<T, E> =
	| { success: true; data: T }
	| { success: false; error: E };

export function ok<T>(data: T): Result<T, never> {
	return { success: true, data };
}

export function err<E>(error: E): Result<never, E> {
	return { success: false, error };
}

export function errorToString(error: unknown): string {
	if (error instanceof Error) return error.message;
	if (typeof error === "string") return error;
	if (typeof error === "number" || typeof error === "boolean")
		return String(error);
	if (error && typeof error === "object") return JSON.stringify(error);
	return String(error);
}
