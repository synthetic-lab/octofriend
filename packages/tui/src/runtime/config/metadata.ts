import path from "node:path";
import { readPackageJson } from "@octofwen/shared";
import { PACKAGE_DIR } from "./paths";

export type Metadata = {
	version: string;
};

const WORKSPACE_PACKAGE_JSON = path.resolve(
	PACKAGE_DIR,
	"../../../../../package.json",
);

export const APP_METADATA = await readMetadata();

async function readMetadata(): Promise<Metadata> {
	const packageJson = await readPackageJson(WORKSPACE_PACKAGE_JSON);
	if (!packageJson.success) return { version: "0.0.0" };
	if (packageJson.data["name"] !== "octofwen") return { version: "0.0.0" };
	const version = packageJson.data["version"];

	return {
		version: typeof version === "string" ? version : "0.0.0",
	};
}
