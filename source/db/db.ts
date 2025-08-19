import { drizzle } from "drizzle-orm/better-sqlite3";
import Database from "better-sqlite3";
import * as schema from "./schema.ts";
import { DB_PATH } from "./setup.ts";

export * as schema from "./schema.ts";

let sqliteDb: Database.Database;

export function db() {
  if(sqliteDb == null) sqliteDb = new Database(DB_PATH);
  return drizzle({
    client: sqliteDb,
    casing: "snake_case",
    schema,
  });
}
