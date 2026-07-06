import fs from "node:fs/promises";
import path from "node:path";
import { PACKAGE_DIR } from "./configuration/paths.ts";
import { err, errorToString, ok, type Result } from "./result.ts";

export type Metadata = {
	version: string;
};

export const APP_METADATA = await readMetadata();

async function readMetadata(): Promise<Metadata> {
	const packageFile = await findWorkspacePackageJson(PACKAGE_DIR);
	if (!packageFile.success) return { version: "0.0.0" };
	const packageJson = await readPackageJson(packageFile.data);
	if (!packageJson.success) return { version: "0.0.0" };
	const version = packageJson.data["version"];

	return {
		version: typeof version === "string" ? version : "0.0.0",
	};
}

async function readPackageJson(
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

async function findWorkspacePackageJson(
	startDir: string,
): Promise<Result<string, string>> {
	let currentDir = startDir;
	while (true) {
		const packageFile = path.join(currentDir, "package.json");
		const packageJson = await readPackageJson(packageFile);
		if (packageJson.success && packageJson.data["name"] === "octofwen") {
			return ok(packageFile);
		}
		if (!packageJson.success && packageJson.error !== "ENOENT") {
			return err(packageJson.error);
		}

		const parentDir = path.dirname(currentDir);
		if (parentDir === currentDir) {
			return err("Could not locate octofwen package metadata");
		}
		currentDir = parentDir;
	}
}
