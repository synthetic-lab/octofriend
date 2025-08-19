import fs from "fs/promises";
import path from "path";
import { migrate as drizzleMigrate } from "drizzle-orm/better-sqlite3/migrator";
import { db, DATA_DIR } from "./conn.ts";

const __dir = import.meta.dirname;

export async function migrate() {
  await fs.mkdir(DATA_DIR, { recursive: true });
  drizzleMigrate(db, {
    migrationsFolder: path.join(__dir, "../../../drizzle/"),
  });
}
