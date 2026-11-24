import updatesText from "../../IN-APP-UPDATES.txt" with { type: "text" };
import { db, schema } from "../db/db.ts";

export async function readUpdates() {
  const mostRecentSeen = await db().query.shownUpdateNotifs.findFirst({
    orderBy: (table, { desc }) => desc(table.id),
  });
  if (mostRecentSeen == null) return updatesText;
  if (mostRecentSeen.update !== updatesText) return updatesText;
  return null;
}

export async function markUpdatesSeen() {
  await db()
    .insert(schema.shownUpdateNotifs)
    .values({
      update: updatesText,
    })
    .onConflictDoNothing();
}
