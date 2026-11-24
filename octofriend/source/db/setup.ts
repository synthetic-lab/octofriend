import * as fsSync from "fs";
import os from "os";
import path from "path";

export const DATA_DIR = path.join(os.homedir(), ".local/share/octofriend");
export const DB_PATH = path.join(DATA_DIR, "sqlite.db");

// You MUST call this function before importing any DB stuff
export function setupDb() {
  fsSync.mkdirSync(DATA_DIR, { recursive: true });
}
