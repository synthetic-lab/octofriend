import path from "node:path";
import { readPackageJson } from "@octofriend/shared";
import { PACKAGE_DIR } from "./config/paths.ts";
import { err, ok, type Result } from "./result.ts";

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

async function findWorkspacePackageJson(
	startDir: string,
): Promise<Result<string, string>> {
	let currentDir = startDir;
	while (true) {
		const packageFile = path.join(currentDir, "package.json");
		const packageJson = await readPackageJson(packageFile);
		if (packageJson.success && packageJson.data["name"] === "octofriend") {
			return ok(packageFile);
		}
		if (!packageJson.success && packageJson.error !== "ENOENT") {
			return err(packageJson.error);
		}

		const parentDir = path.dirname(currentDir);
		if (parentDir === currentDir) {
			return err("Could not locate octofriend package metadata");
		}
		currentDir = parentDir;
	}
}
