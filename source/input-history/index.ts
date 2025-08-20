import { asc, count, inArray } from "drizzle-orm";
import { db } from "../db/db.ts";
import { inputHistoryTable } from "./schema.ts";
import { expectOne } from "../db/query.ts";

const MAX_HISTORY_ITEMS = 100;

let currentHistory: string[] = [];
let isInitialized = false;

export function getCurrentHistory(): string[] {
  if (!isInitialized) {
    throw new Error("Input history was not initalized.");
  }
  return currentHistory;
}

export function appendToInputHistory(input: string): void {
  if (!isInitialized) {
    throw new Error("Input history was not initalized.");
  }
  if (input.trim()) {
    currentHistory.push(input.trim());
  }
}

export async function loadInputHistory() {
  if (isInitialized) return;

  try {
    const historyRecords = await db()
      .select({ input: inputHistoryTable.input })
      .from(inputHistoryTable)
      .orderBy(asc(inputHistoryTable.createdAt))
      .limit(MAX_HISTORY_ITEMS);

    currentHistory = historyRecords.map(record => record.input);
    isInitialized = true;
  } catch (error) {
    console.warn("Failed to load input history:", error);
  }
}

export async function saveInputHistory(): Promise<void> {
  if (currentHistory.length === 0) return;

  try {
    const historyItems = currentHistory.map((input, index) => ({
      input: input.trim(),
      createdAt: new Date(Date.now() + index),
    })).filter(item => item.input);

    if (historyItems.length > 0) {
      await db()
        .insert(inputHistoryTable)
        .values(historyItems);
    }

    // Truncate old entries by createdAt, keeping only the most recent MAX_HISTORY_ITEMS
    const { count: totalCount } = expectOne(await db()
      .select({ count: count() })
      .from(inputHistoryTable));

    if (totalCount > MAX_HISTORY_ITEMS) {
      const recordsToDelete = await db()
        .select({ id: inputHistoryTable.id })
        .from(inputHistoryTable)
        .orderBy(asc(inputHistoryTable.createdAt))
        .limit(totalCount - MAX_HISTORY_ITEMS);

      if (recordsToDelete.length > 0) {
        const idsToDelete = recordsToDelete.map(r => r.id);
        await db()
          .delete(inputHistoryTable)
          .where(inArray(inputHistoryTable.id, idsToDelete));
      }
    }
  } catch (error) {
    console.warn("Failed to save input history:", error);
  }
}

export const _exportedForTest = {
  resetCurrentHistory() { currentHistory = []; isInitialized = false; },
};