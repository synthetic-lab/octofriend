import { t } from "structural";

const QuotaEntryRawSchema = t.subtype({
  remaining: t.num,
  max: t.num,
  nextTickAt: t.str,
  tickPercent: t.num,
});

const WeeklyEntryRawSchema = t.subtype({
  nextRegenAt: t.str,
  percentRemaining: t.num,
  maxCredits: t.str,
  remainingCredits: t.str,
  nextRegenCredits: t.str,
});

type WithDateFields<T extends {}, K extends keyof T> = Omit<T, K> & {
  [P in K]: Date;
};

export type QuotaEntry = WithDateFields<t.GetType<typeof QuotaEntryRawSchema>, "nextTickAt">;
export type WeeklyEntry = WithDateFields<t.GetType<typeof WeeklyEntryRawSchema>, "nextRegenAt">;

export type QuotaData = {
  rollingFiveHourLimit?: QuotaEntry;
  weeklyTokenLimit?: WeeklyEntry;
};

function parseOptionalQuotaEntry(raw: unknown): QuotaEntry | undefined {
  if (raw == null) return undefined;
  const result = QuotaEntryRawSchema.sliceResult(raw);
  if (result instanceof t.Err) return undefined;
  const nextTickAt = new Date(result.nextTickAt);
  if (isNaN(nextTickAt.getTime())) return undefined;
  return {
    ...result,
    nextTickAt,
  };
}

function parseOptionalWeeklyEntry(raw: unknown): WeeklyEntry | undefined {
  if (raw == null) return undefined;
  const result = WeeklyEntryRawSchema.sliceResult(raw);
  if (result instanceof t.Err) return undefined;
  const nextRegenAt = new Date(result.nextRegenAt);
  if (isNaN(nextRegenAt.getTime())) return undefined;
  return {
    ...result,
    nextRegenAt,
  };
}

export function parseQuotaJson(data: string): QuotaData | undefined {
  try {
    const raw = JSON.parse(data);
    if (raw == null || typeof raw !== "object" || Array.isArray(raw)) return undefined;

    const rollingFiveHourLimit = parseOptionalQuotaEntry(raw["rollingFiveHourLimit"]);
    const weeklyTokenLimit = parseOptionalWeeklyEntry(raw["weeklyTokenLimit"]);
    if (!rollingFiveHourLimit && !weeklyTokenLimit) return undefined;

    return {
      ...(rollingFiveHourLimit ? { rollingFiveHourLimit } : {}),
      ...(weeklyTokenLimit ? { weeklyTokenLimit } : {}),
    };
  } catch {
    /* ignore errors, they're out-of-place in the menu */
    return undefined;
  }
}
