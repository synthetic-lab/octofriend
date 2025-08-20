import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { db } from '../db/db.ts';
import { migrate } from '../db/migrate.ts';
import { inputHistoryTable } from './schema.ts';
import { getCurrentHistory, appendToInputHistory, loadInputHistory, saveInputHistory, _exportedForTest } from './index.ts';

describe('Input History', () => {
  beforeAll(async () => {
    await migrate();
  });

  beforeEach(async () => {
    await db().delete(inputHistoryTable);
    _exportedForTest.resetCurrentHistory();
  });

  it('should load and save history', async () => {
    // Load empty history
    await loadInputHistory();
    expect(getCurrentHistory()).toEqual([]);

    // Add some history
    appendToInputHistory('command 1');
    appendToInputHistory('command 2');
    expect(getCurrentHistory()).toContain('command 1');
    expect(getCurrentHistory()).toContain('command 2');

    // Save history
    await saveInputHistory();

    // Verify it was saved to database
    const rows = await db()
      .select({ input: inputHistoryTable.input })
      .from(inputHistoryTable)
      .orderBy(inputHistoryTable.createdAt);

    expect(rows.map(r => r.input)).toContain('command 1');
    expect(rows.map(r => r.input)).toContain('command 2');
  });

  it('should handle empty and whitespace input correctly', async () => {
    await loadInputHistory();

    appendToInputHistory('valid command');
    appendToInputHistory('  trimmed  ');
    appendToInputHistory('');
    appendToInputHistory('   ');

    const history = getCurrentHistory();
    expect(history).toContain('valid command');
    expect(history).toContain('trimmed');
    expect(history.filter(h => h === '' || h.trim() === '')).toHaveLength(0);
  });

  it('should load existing data from database', async () => {
    // Insert test data directly into database
    await db().insert(inputHistoryTable).values([
      { input: 'existing 1', createdAt: new Date(Date.now()) },
      { input: 'existing 2', createdAt: new Date(Date.now() + 1000) }
    ]);

    // Load should pick up existing data
    await loadInputHistory();
    const history = getCurrentHistory();
    expect(history).toContain('existing 1');
    expect(history).toContain('existing 2');
  });
});