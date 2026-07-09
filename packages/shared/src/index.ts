import fs from "node:fs/promises";

export type Result<T, E> =
	| { success: true; data: T }
	| { success: false; error: E };

const ok = <T, E>(data: T): Result<T, E> => ({ success: true, data });
const err = <T, E>(error: E): Result<T, E> => ({ success: false, error });

export async function readPackageJson(
	packageFile: string,
): Promise<Result<Record<string, unknown>, string>> {
	try {
		const packageJson = JSON.parse(await fs.readFile(packageFile, "utf8"));
		return typeof packageJson === "object" && packageJson !== null
			? ok(packageJson as Record<string, unknown>)
			: err(`Invalid package metadata in ${packageFile}`);
	} catch (error) {
		if (
			error &&
			typeof error === "object" &&
			"code" in error &&
			error.code === "ENOENT"
		) {
			return err("ENOENT");
		}
		return err(errorToString(error));
	}
}

function errorToString(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}
