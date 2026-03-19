import { t } from "structural";

export type RequestUsage = {
  used: number;
  limit: number;
  renewsAt: Date;
};

export type TokenUsage = {
  current: number;
  limit: number;
};

export type WeeklyTokenUsage = {
  renewsAt: Date;
  input: TokenUsage;
  output: TokenUsage;
};

export type QuotaData = {
  subscription: RequestUsage;
  freeToolCalls?: RequestUsage;
  weeklyTokenLimit?: WeeklyTokenUsage;
};

const QuotaEntryRawSchema = t.subtype({
  limit: t.num,
  requests: t.num,
  renewsAt: t.str,
});

const TokenUsageRawSchema = t.subtype({
  current: t.num,
  limit: t.num,
});

const WeeklyTokenLimitRawSchema = t.subtype({
  renewsAt: t.str,
  input: TokenUsageRawSchema,
  output: TokenUsageRawSchema,
});

const QuotaDataRawSchema = t.subtype({
  subscription: QuotaEntryRawSchema,
  freeToolCalls: t.optional(QuotaEntryRawSchema),
  weeklyTokenLimit: t.optional(WeeklyTokenLimitRawSchema),
});

function parseQuotaEntry(raw: t.GetType<typeof QuotaEntryRawSchema>): RequestUsage | undefined {
  const renewsAt = new Date(raw.renewsAt);
  if (isNaN(renewsAt.getTime())) return undefined;
  return { limit: raw.limit, used: raw.requests, renewsAt };
}

function parseWeeklyTokenLimit(
  raw: t.GetType<typeof WeeklyTokenLimitRawSchema>,
): WeeklyTokenUsage | undefined {
  const renewsAt = new Date(raw.renewsAt);
  if (isNaN(renewsAt.getTime())) return undefined;
  return { renewsAt, input: raw.input, output: raw.output };
}

export function parseQuotaJson(data: string): QuotaData | undefined {
  try {
    const result = QuotaDataRawSchema.sliceResult(JSON.parse(data));
    if (result instanceof t.Err) return undefined;
    const subscription = parseQuotaEntry(result.subscription);
    if (!subscription) return undefined;
    const freeToolCalls = result.freeToolCalls ? parseQuotaEntry(result.freeToolCalls) : undefined;
    const weeklyTokenLimit = result.weeklyTokenLimit
      ? parseWeeklyTokenLimit(result.weeklyTokenLimit)
      : undefined;
    return { subscription, freeToolCalls, weeklyTokenLimit };
  } catch {
    /* ignore errors, they're out-of-place in the menu */
    return undefined;
  }
}
