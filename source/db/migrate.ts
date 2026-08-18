import crypto from "crypto";
import fs from "fs";
import os from "os";
import path from "path";
import { migrate as drizzleMigrate } from "drizzle-orm/bun-sqlite/migrator";
import { db } from "./db.ts";

const __dir = import.meta.dirname;

export type EmbeddedMigrations = {
  journal: string;
  migrations: { name: string; sql: string }[];
};

// In compiled binaries the migrations are baked into the bundle by build.ts
// (see migrations.codegen.ts) instead of living in an external drizzle/
// folder; bin.ts supplies them here at startup.
let embeddedMigrations: EmbeddedMigrations | null = null;

export function setEmbeddedMigrations(migrations: EmbeddedMigrations) {
  embeddedMigrations = migrations;
}

export async function migrate() {
  drizzleMigrate(db(), {
    migrationsFolder: migrationsFolder(),
  });
}

function migrationsFolder(): string {
  if (embeddedMigrations == null) {
    return path.join(__dir, "../../drizzle/");
  }
  return materializeMigrations(embeddedMigrations);
}

// drizzle's migrator needs a real, listable folder; embedded module assets
// aren't directory-listable outside of bun 1.4's `--asset`, so write the
// embedded migrations to a content-hashed tmp dir and migrate from there.
function materializeMigrations(manifest: EmbeddedMigrations): string {
  const hash = crypto
    .createHash("sha256")
    .update(manifest.journal)
    .update(manifest.migrations.map(({ sql }) => sql).join(""))
    .digest("hex")
    .slice(0, 16);
  const folder = path.join(os.tmpdir(), `octofriend-migrations-${hash}`);
  fs.mkdirSync(path.join(folder, "meta"), { recursive: true });
  fs.writeFileSync(path.join(folder, "meta/_journal.json"), manifest.journal);
  for (const migration of manifest.migrations) {
    fs.writeFileSync(path.join(folder, `${migration.name}.sql`), migration.sql);
  }
  return folder;
}
