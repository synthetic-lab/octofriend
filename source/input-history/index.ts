import { sql } from "drizzle-orm";
import { db } from "../db/db.ts";
import { inputHistoryTable } from "./schema/input-history-table.ts";

const MAX_HISTORY_ITEMS = 100;
const MAX_HISTORY_TRUNCATION_BATCH = 20;

export async function loadInputHistory(): Promise<InputHistory> {
  try {
    const historyRecords = await db().query.inputHistoryTable.findMany({
      orderBy: (table, { asc }) => asc(table.id),
      limit: MAX_HISTORY_ITEMS,
    });

    const history = historyRecords.map(({ input }) => input);

    return new InputHistory(history);
  } catch (error) {
    console.warn("Failed to load input history:", error);
    return new InputHistory([]);
  }
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

    try {
      await db()
        .insert(inputHistoryTable)
        .values({ input });

      await this.truncateOldEntries();
    } catch (error) {
      console.warn("Failed to save input history:", error);
    }
  }

  private async truncateOldEntries(): Promise<void> {
    if (this.history.length % MAX_HISTORY_TRUNCATION_BATCH === 0) {
      db().run(sql`
        DELETE FROM ${inputHistoryTable}
        WHERE id NOT IN (
          SELECT id FROM ${inputHistoryTable}
          ORDER BY id DESC
          LIMIT ${MAX_HISTORY_ITEMS}
        )
      `);
    }
  }
}

export const _exportedForTest = { MAX_HISTORY_ITEMS, MAX_HISTORY_TRUNCATION_BATCH }