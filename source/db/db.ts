import { drizzle } from "drizzle-orm/better-sqlite3";
import Database from "better-sqlite3";
import * as schema from "./schema.ts";
import { DB_PATH } from "./setup.ts";

export * as schema from "./schema.ts";

let sqliteDb: Database.Database;
let client: ReturnType<typeof drizzle<typeof schema>>;

export function db() {
  if(sqliteDb == null) {
    if(process.env['NODE_ENV'] === 'test') {
      sqliteDb = new Database(':memory:');
    } else {
      sqliteDb = new Database(DB_PATH);
    }
  }
  if(client == null) {
    client = drizzle({
      client: sqliteDb,
      casing: "snake_case",
      schema,
    });
  }
  return client;
}
