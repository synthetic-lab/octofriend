export type TestResult<T, E> =
	| { success: true; data: T }
	| { success: false; error: E };

export function expectOk<T, E>(result: TestResult<T, E>): T {
	if (result.success) return result.data;
	throw new Error(String(result.error));
}

export function expectPresent<T>(value: T): NonNullable<T> {
	if (value === null || value === undefined) {
		throw new Error("Expected value to be present");
	}
	return value;
}

export function deferred<T>() {
	let resolve: (value: T) => void = () => undefined;
	const promise = new Promise<T>((nextResolve) => {
		resolve = nextResolve;
	});
	return { promise, resolve };
}

export async function waitFor(predicate: () => boolean): Promise<void> {
	for (let attempt = 0; attempt < 1000; attempt += 1) {
		if (predicate()) return;
		await Bun.sleep(1);
	}
	throw new Error("Timed out waiting for condition");
}
