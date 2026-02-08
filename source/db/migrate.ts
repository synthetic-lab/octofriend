import path from "path";
import * as fs from "node:fs";
import { migrate as drizzleMigrate } from "drizzle-orm/better-sqlite3/migrator";
import { db } from "./db.ts";

const __dir = import.meta.dirname;

export async function migrate() {
  const NODE_ENV = process.env["NODE_ENV"];
  const migrationsPath =
    NODE_ENV === "test"
      ? path.join(__dir, "../../drizzle/")
      : path.join(__dir, "../../../drizzle/");

  const journalPath = path.join(migrationsPath, "meta/_journal.json");
  const journalExists = fs.existsSync(journalPath);

  if (process.env["DEBUG_MIGRATIONS"]) {
    console.error(`[MIGRATE] __dir: ${__dir}`);
    console.error(`[MIGRATE] NODE_ENV: ${NODE_ENV}`);
    console.error(`[MIGRATE] migrationsPath: ${migrationsPath}`);
    console.error(`[MIGRATE] journalPath: ${journalPath}`);
    console.error(`[MIGRATE] journalExists: ${journalExists}`);
    console.error(`[MIGRATE] cwd: ${process.cwd()}`);
  }

  if (!journalExists) {
    throw new Error(
      `Migration journal not found at ${journalPath}. Ensure the drizzle migrations directory is included in the build output.`,
    );
  }

  drizzleMigrate(db(), {
    migrationsFolder: migrationsPath,
  });
}
