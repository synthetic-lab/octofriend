import path from "path";
import { migrate as drizzleMigrate } from "drizzle-orm/bun-sqlite/migrator";
import { db } from "./db.ts";
import { isStandaloneExecutable } from "../bun-env.ts";

const __dir = import.meta.dirname;

export async function migrate() {
  const migrationsPath = isStandaloneExecutable()
    ? "/$bunfs/root/drizzle"
    : path.join(__dir, "../../drizzle/");

  drizzleMigrate(db(), {
    migrationsFolder: migrationsPath,
  });
}
