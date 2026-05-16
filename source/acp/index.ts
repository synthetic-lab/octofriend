#!/usr/bin/env node

import os from "os";
import path from "path";
import { Readable, Writable } from "stream";
import * as acp from "@agentclientprotocol/sdk";
import { readConfig, readMetadata } from "../config.ts";
import { fileExists } from "../fs-utils.ts";
import { OctofriendAcpAgent } from "./agent.ts";

const CONFIG_STANDARD_DIR = path.join(os.homedir(), ".config/octofriend/");
const CONFIG_JSON5_FILE = path.join(CONFIG_STANDARD_DIR, "octofriend.json5");

function routeConsoleToStderr() {
  console.log = (...args: unknown[]) => console.error(...args);
  console.info = (...args: unknown[]) => console.error(...args);
}

function parseArgs(argv: string[]) {
  let configPath: string | undefined;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];

    if (arg === "--help" || arg === "-h") {
      console.error("Usage: octofriend ACP adapter");
      console.error("  node dist/source/acp/index.js [--config <path>]");
      process.exit(0);
    }

    if (arg === "--config") {
      const next = argv[i + 1];
      if (!next) throw new Error("Missing value for --config");
      configPath = next;
      i += 1;
      continue;
    }

    throw new Error(`Unknown argument: ${arg}`);
  }

  return {
    configPath,
  };
}

async function resolveConfigPath(inputPath?: string) {
  if (inputPath) {
    if (!(await fileExists(inputPath))) {
      throw new Error(`Config file not found: ${inputPath}`);
    }
    return inputPath;
  }

  if (await fileExists(CONFIG_JSON5_FILE)) {
    return CONFIG_JSON5_FILE;
  }

  throw new Error(
    `No config found. Expected ${CONFIG_JSON5_FILE}. Run 'octofriend init' first or pass --config.`,
  );
}

async function main() {
  routeConsoleToStderr();
  const args = parseArgs(process.argv.slice(2));
  const configPath = await resolveConfigPath(args.configPath);
  const config = await readConfig(configPath);
  const metadata = await readMetadata();

  const toClient = Writable.toWeb(process.stdout);
  const toAgent = Readable.toWeb(process.stdin) as ReadableStream<Uint8Array>;
  const stream = acp.ndJsonStream(toClient, toAgent);

  const connection = new acp.AgentSideConnection(
    (conn: acp.AgentSideConnection) => new OctofriendAcpAgent(conn, config, metadata),
    stream,
  );

  await connection.closed;
}

main().catch(error => {
  const message = error instanceof Error ? error.stack || error.message : String(error);
  console.error(message);
  process.exit(1);
});
