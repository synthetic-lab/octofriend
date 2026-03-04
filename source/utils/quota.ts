import { t } from "structural";

export type QuotaEntry = {
  used: number;
  limit: number;
  renewsAt: Date;
};

export type QuotaData = {
  subscription: QuotaEntry;
  freeToolCalls?: QuotaEntry;
};

const QuotaEntryRawSchema = t.subtype({
  limit: t.num,
  requests: t.num,
  renewsAt: t.str,
});

const QuotaDataRawSchema = t.subtype({
  subscription: QuotaEntryRawSchema,
  freeToolCalls: t.optional(QuotaEntryRawSchema),
});

function parseQuotaEntry(raw: t.GetType<typeof QuotaEntryRawSchema>): QuotaEntry | undefined {
  const renewsAt = new Date(raw.renewsAt);
  if (isNaN(renewsAt.getTime())) return undefined;
  return { limit: raw.limit, used: raw.requests, renewsAt };
}

export function parseQuotaJson(data: string): QuotaData | undefined {
  try {
    const result = QuotaDataRawSchema.sliceResult(JSON.parse(data));
    if (result instanceof t.Err) return undefined;
    const subscription = parseQuotaEntry(result.subscription);
    if (!subscription) return undefined;
    const freeToolCalls = result.freeToolCalls ? parseQuotaEntry(result.freeToolCalls) : undefined;
    return { subscription, freeToolCalls };
  } catch {
    /* ignore errors, they're out-of-place in the menu */
    return undefined;
  }
}
