import path from "path";
import { migrate as drizzleMigrate } from "drizzle-orm/better-sqlite3/migrator";
import { db } from "./db.ts";

const __dir = import.meta.dirname;

export async function migrate() {
  const migrationsPath = process.env["NODE_ENV"] === "test"
    ? path.join(__dir, "../../drizzle/")
    : path.join(__dir, "../../../drizzle/");

  drizzleMigrate(db(), {
    migrationsFolder: migrationsPath,
  });
}
