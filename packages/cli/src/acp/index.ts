#!/usr/bin/env bun
import { Readable, Writable } from "node:stream";
import * as acp from "@agentclientprotocol/sdk";
import { readConfig } from "../config/config-file.ts";
import { CONFIG_FILE } from "../config/paths.ts";
import { APP_METADATA } from "../metadata.ts";
import { OctofriendAcpAgent } from "./agent.ts";

function parseArgs(argv: string[]): { configPath: string } {
	let configPath = CONFIG_FILE;
	for (let index = 0; index < argv.length; index += 1) {
		const arg = argv[index];
		if (arg === "--config") {
			const value = argv[index + 1];
			if (!value) throw new Error("Missing value for --config");
			configPath = value;
			index += 1;
		} else if (arg === "--help" || arg === "-h") {
			console.error("Usage: octofriend-acp [--config <path>]");
			process.exit(0);
		} else {
			throw new Error(`Unknown argument: ${arg}`);
		}
	}
	return { configPath };
}

async function main(): Promise<void> {
	console.log = (...args: unknown[]) => console.error(...args);
	console.info = (...args: unknown[]) => console.error(...args);
	const { configPath } = parseArgs(process.argv.slice(2));
	const config = await readConfig(configPath);
	const output = Writable.toWeb(process.stdout);
	const input = Readable.toWeb(
		process.stdin,
	) as unknown as ReadableStream<Uint8Array>;
	const connection = new acp.AgentSideConnection(
		(conn) => new OctofriendAcpAgent(conn, config, APP_METADATA),
		acp.ndJsonStream(output, input),
	);
	await connection.closed;
}

main().catch((error: unknown) => {
	console.error(
		error instanceof Error ? (error.stack ?? error.message) : String(error),
	);
	process.exitCode = 1;
});
