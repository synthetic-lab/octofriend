import path from "path";
import { migrate as drizzleMigrate } from "drizzle-orm/better-sqlite3/migrator";
import { db } from "./db.ts";

const __dir = import.meta.dirname;

export async function migrate() {
  drizzleMigrate(db(), {
    migrationsFolder: path.join(__dir, "../../../drizzle/"),
  });
}
