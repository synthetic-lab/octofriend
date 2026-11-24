export class RowError extends Error {
  constructor(message: string) {
    super(message);
    this.name = this.constructor.name;
  }
}

export function expectExists<T>(obj: T | null | undefined): T {
  if (obj == null) throw new RowError("Row was null");
  return obj;
}

export function expectOne<T>(rows: T[]): T {
  if (rows.length === 0) throw new RowError("No rows returned");
  if (rows.length > 1) throw new RowError(`Expected one row, but got ${rows.length}`);
  return rows[0];
}

export function expectAtMostOne<T>(rows: T[]): T | null {
  if (rows.length === 0) return null;
  if (rows.length > 1) throw new RowError(`Expected one row, but got ${rows.length}`);
  return rows[0];
}
