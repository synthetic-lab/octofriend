import path from "path";
import { migrate as drizzleMigrate } from "drizzle-orm/better-sqlite3/migrator";
import { db } from "./db.ts";

const __dir = import.meta.dirname;

export async function migrate() {
  const migrationsPath = path.join(__dir, "../../drizzle/");
  console.log('Looking for migrations at:', migrationsPath);

  drizzleMigrate(db(), {
    migrationsFolder: migrationsPath,
  });
}
