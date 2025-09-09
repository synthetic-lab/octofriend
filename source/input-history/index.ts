import { sql, notInArray, desc } from "drizzle-orm";
import { db } from "../db/db.ts";
import { inputHistoryTable } from "./schema/input-history-table.ts";

const MAX_HISTORY_ITEMS = 100;
const MAX_HISTORY_TRUNCATION_BATCH = 20;

export async function loadInputHistory(): Promise<InputHistory> {
  const historyRecords = await db().query.inputHistoryTable.findMany({
    orderBy: (table, { asc }) => asc(table.id),
    limit: MAX_HISTORY_ITEMS,
  });

  const history = historyRecords.map(({ input }) => input);

  return new InputHistory(history);
}

export class InputHistory {
  constructor(private readonly history: string[]) {}

  getCurrentHistory(): string[] {
    return this.history;
  }

  async appendToInputHistory(input: string): Promise<void> {
    const trimmedInput = input.trim();
    if (!trimmedInput) return;

    this.history.push(input);

    await db().insert(inputHistoryTable).values({ input });

    await this.truncateOldEntries();
  }

  private async truncateOldEntries(): Promise<void> {
    db().transaction((db) => {
      const historyToKeep = db
        .select({ id: inputHistoryTable.id })
        .from(inputHistoryTable)
        .orderBy(desc(inputHistoryTable.id))
        .limit(MAX_HISTORY_ITEMS);

      db.delete(inputHistoryTable)
        .where(notInArray(inputHistoryTable.id, historyToKeep))
        .run();
    });
  }
}

export const _exportedForTest = { MAX_HISTORY_ITEMS, MAX_HISTORY_TRUNCATION_BATCH }