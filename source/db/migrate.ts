import path from "path";
import { migrate as drizzleMigrate } from "drizzle-orm/better-sqlite3/migrator";
import { db } from "./db.ts";

const __dir = import.meta.dirname;

export async function migrate() {
  const migrationsPath =
    process.env["NODE_ENV"] === "test"
      ? path.join(__dir, "../../drizzle/")
      : path.join(__dir, "../../../drizzle/");

  try {
    drizzleMigrate(db(), {
      migrationsFolder: migrationsPath,
    });
  } catch (e) {
    throw new Error(
      `Migration failed at ${migrationsPath}: ${e instanceof Error ? e.message : String(e)}`,
    );
  }
}
