import os from "os";
import path from "path";
import { drizzle } from "drizzle-orm/better-sqlite3";
import Database from "better-sqlite3";
import * as schema from "./schema.ts";

export const DATA_DIR = path.join(os.homedir(), ".local/share/octofriend");
const DB_PATH = path.join(DATA_DIR, "sqlite.db");

const sqliteDb = new Database(DB_PATH);
export const db = drizzle({
  client: sqliteDb,
  casing: "snake_case",
  schema,
});
