import path from "path";
import fs from "fs/promises";
import * as schema from "../db/schema.ts";
import { db } from "../db/conn.ts";
const __dirname = import.meta.dirname;

const UPDATES_FILE = path.join(__dirname, "../../../IN-APP-UPDATES.txt");

export async function readUpdates() {
  const updates = await currentUpdates();
  const mostRecentSeen = await db.query.shownUpdateNotifs.findFirst({
    orderBy: (table, { desc }) => desc(table.id),
  });
  if(mostRecentSeen == null) return updates;
  if(mostRecentSeen.update !== updates) return updates;
  return null;
}

export async function markUpdatesSeen() {
  const update = await currentUpdates();
  await db.insert(schema.shownUpdateNotifs).values({
    update,
  }).onConflictDoNothing();
}

async function currentUpdates() {
  return await fs.readFile(UPDATES_FILE, "utf8");
}
