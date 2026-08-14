import fs from "node:fs";
import { sql } from "drizzle-orm";
import { expect, test } from "vitest";
import { db } from "./db.ts";
import { migrate, setEmbeddedMigrations } from "./migrate.ts";
import { EMBEDDED_MIGRATIONS } from "./migrations.generated.ts";
import { GENERATED_MODULE_PATH, generateMigrationsModule } from "./migrations.codegen.ts";

// The compiled binary ships the checked-in generated module; drift between it
// and the drizzle/ folder would silently ship stale migrations.
test("generated migrations module is fresh", () => {
  expect(fs.readFileSync(GENERATED_MODULE_PATH, "utf-8")).toBe(generateMigrationsModule());
});

// Compiled binaries materialize the embedded migrations to a tmp folder and
// run the stock drizzle migrator on it; verify that flow applies everything.
test("embedded migrations apply to a fresh database", async () => {
  setEmbeddedMigrations(EMBEDDED_MIGRATIONS);
  await migrate();
  const tables = (
    db().all(sql.raw("SELECT name FROM sqlite_master WHERE type = 'table'")) as {
      name: string;
    }[]
  ).map(row => row.name);
  expect(tables).toContain("tree_nodes");
  expect(tables).toContain("history_items");
});
