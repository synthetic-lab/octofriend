import path from "path";
import { migrate as drizzleMigrate } from "drizzle-orm/bun-sqlite/migrator";
import { isStandaloneExecutable } from "../bun-env.ts";
import { db } from "./db.ts";

const __dir = import.meta.dirname;

export async function migrate() {
  // In dev this is the repo's drizzle/ folder. In compiled binaries build.ts
  // embeds that same directory via `compile.assets` (bun 1.4): node:fs reads
  // then hit the in-bundle filesystem, but every bundled module's
  // import.meta.dir collapses to /$bunfs/root, so the path is "drizzle"
  // relative to this module rather than "../../drizzle/".
  drizzleMigrate(db(), {
    migrationsFolder: path.join(__dir, isStandaloneExecutable() ? "drizzle" : "../../drizzle/"),
  });
}
