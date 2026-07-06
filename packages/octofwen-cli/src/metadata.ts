import fs from "node:fs/promises";
import path from "node:path";
import { PACKAGE_DIR } from "./configuration/paths.ts";

export type Metadata = {
	version: string;
};

export const APP_METADATA = await readMetadata();

async function readMetadata(): Promise<Metadata> {
	const packageFile = await findWorkspacePackageJson(PACKAGE_DIR);
	const packageJson = JSON.parse(await fs.readFile(packageFile, "utf8"));

	return {
		version: packageJson["version"],
	};
}

async function findWorkspacePackageJson(startDir: string): Promise<string> {
	let currentDir = startDir;
	while (true) {
		const packageFile = path.join(currentDir, "package.json");
		try {
			const packageJson = JSON.parse(await fs.readFile(packageFile, "utf8"));
			if (packageJson["name"] === "octofwen") return packageFile;
		} catch (error) {
			if (
				!error ||
				typeof error !== "object" ||
				!("code" in error) ||
				error.code !== "ENOENT"
			) {
				throw error;
			}
		}

		const parentDir = path.dirname(currentDir);
		if (parentDir === currentDir) {
			throw new Error("Could not locate octofwen package metadata");
		}
		currentDir = parentDir;
	}
}
