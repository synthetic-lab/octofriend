import { sql } from "drizzle-orm";
import { expect, test } from "bun:test";
import { db } from "./db.ts";
import { migrate } from "./migrate.ts";

test("migrations apply to a fresh database", async () => {
  await migrate();
  const tables = (
    db().all(sql.raw("SELECT name FROM sqlite_master WHERE type = 'table'")) as {
      name: string;
    }[]
  ).map(row => row.name);
  expect(tables).toContain("tree_nodes");
  expect(tables).toContain("history_items");
});
