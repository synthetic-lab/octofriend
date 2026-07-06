import { configRunNotify } from "./agentd-config.ts";
import type { Config } from "./schemas.ts";

export async function runNotifyCommand(config: Config): Promise<void> {
	await configRunNotify(config);
}
