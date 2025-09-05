import { describe, it, expect, beforeEach } from 'vitest';
import { db } from '../db/db.ts';
import { inputHistoryTable } from './schema/input-history-table.ts';
import { _exportedForTest, InputHistory, loadInputHistory } from './index.ts';
import { count } from "drizzle-orm";

describe('Input History', () => {
  beforeEach(async () => {
    await db().delete(inputHistoryTable);
  });

  it('should load empty history and append items', async () => {
    const inputHistory = await loadInputHistory();
    expect(inputHistory.getCurrentHistory()).toEqual([]);

    await inputHistory.appendToInputHistory('command 1');
    await inputHistory.appendToInputHistory('command 2');

    expect(inputHistory.getCurrentHistory()).toContain('command 1');
    expect(inputHistory.getCurrentHistory()).toContain('command 2');

    const rows = await db()
      .select({ input: inputHistoryTable.input })
      .from(inputHistoryTable)
      .orderBy(inputHistoryTable.id);
    expect(rows.map(r => r.input)).toContain('command 1');
    expect(rows.map(r => r.input)).toContain('command 2');
  });

  it('should handle empty and whitespace input correctly', async () => {
    const inputHistory = await loadInputHistory();

    await inputHistory.appendToInputHistory('valid command');
    await inputHistory.appendToInputHistory('  trimmed  ');
    await inputHistory.appendToInputHistory('');
    await inputHistory.appendToInputHistory('   ');

    const history = inputHistory.getCurrentHistory();
    expect(history).toContain('valid command');
    expect(history).toContain('  trimmed  ');
    expect(history.filter(h => h === '' || h.trim() === '')).toHaveLength(0);
  });

  it('should load existing data from database', async () => {
    await db().insert(inputHistoryTable).values([
      { input: 'existing 1' },
      { input: 'existing 2' }
    ]);

    const inputHistory = await loadInputHistory();
    const history = inputHistory.getCurrentHistory();
    expect(history).toContain('existing 1');
    expect(history).toContain('existing 2');
  });

  it('should truncate old entries when history exceeds limit', async () => {
    const inputHistory = await loadInputHistory();

    const numCommandsToTest = _exportedForTest.MAX_HISTORY_ITEMS + _exportedForTest.MAX_HISTORY_TRUNCATION_BATCH;
    for (let i = 1; i <= numCommandsToTest; i++) {
      await inputHistory.appendToInputHistory(`command ${i}`);
    }

    const totalRows = await db()
      .select({ count: count() })
      .from(inputHistoryTable);

    expect(totalRows[0].count).toBeLessThanOrEqual(_exportedForTest.MAX_HISTORY_ITEMS);

    const remainingRows = await db()
      .select({ input: inputHistoryTable.input })
      .from(inputHistoryTable)
      .orderBy(inputHistoryTable.id);

    expect(remainingRows.map(r => r.input)).toContain(`command ${numCommandsToTest}`);
    expect(remainingRows.map(r => r.input)).not.toContain('command 1');
  });
});