import React, { useEffect, useState } from "react";
import { apiKeyFromAuth, readAuthForModel, useConfig } from "../config.ts";
import { useModel, useAppStore } from "../state.ts";
import type { QuotaData, QuotaEntry, WeeklyEntry } from "../utils/quota.ts";
import { parseQuotaJson } from "../utils/quota.ts";
import { formatTimeUntil } from "../time.ts";
import { Div, Span } from "paintcannon-react";
async function fetchQuota(apiKey: string): Promise<QuotaData | null> {
  try {
    const response = await fetch("https://api.synthetic.new/v2/quotas", {
      headers: {
        Authorization: `Bearer ${apiKey}`,
      },
    });
    if (!response.ok) return null;
    return parseQuotaJson(await response.text()) ?? null;
  } catch {
    return null;
  }
}
type QuotaRowProps = {
  label: string;
  entry: QuotaEntry;
};
function formatQuotaNumber(value: number): string {
  if (Number.isInteger(value)) return value.toString();
  return Math.floor(value * 10) / 10 + "";
}
function QuotaRow({ label, entry }: QuotaRowProps) {
  const tickPercent = formatQuotaNumber(entry.tickPercent * 100);
  const showNextRegen = entry.remaining < entry.max;
  return (
    <Div
      style={{
        display: "flex",
        whiteSpace: "pre-wrap",
        flexDirection: "column",
      }}
    >
      <Span>{`${label}: ${formatQuotaNumber(entry.remaining)} / ${formatQuotaNumber(entry.max)} remaining`}</Span>
      {showNextRegen ? (
        <Span
          style={{
            color: "gray",
          }}
        >{`Next regen: ${tickPercent}% ${formatTimeUntil(entry.nextTickAt)}`}</Span>
      ) : null}
    </Div>
  );
}
type WeeklyQuotaRowProps = {
  label: string;
  entry: WeeklyEntry;
};
function WeeklyQuotaRow({ label, entry }: WeeklyQuotaRowProps) {
  const showNextRegen = entry.remainingCredits !== entry.maxCredits;
  return (
    <Div
      style={{
        display: "flex",
        whiteSpace: "pre-wrap",
        flexDirection: "column",
      }}
    >
      <Span>{`${label}: ${entry.remainingCredits} / ${entry.maxCredits} remaining`}</Span>
      {showNextRegen ? (
        <Span
          style={{
            color: "gray",
          }}
        >
          {`Next regen: ${entry.nextRegenCredits} ${formatTimeUntil(entry.nextRegenAt)}`}
        </Span>
      ) : null}
    </Div>
  );
}
export const MenuQuotaIndicator = () => {
  const config = useConfig();
  const model = useModel();
  const storeQuota = useAppStore(state => state.quotaData);
  const [fetchedQuota, setFetchedQuota] = useState<QuotaData | null>(null);

  // should only be used if menu is opened before the agent runs
  // otherwise, quota should come from the store, read from header values in the compiler
  useEffect(() => {
    if (storeQuota) return;
    let cancelled = false;
    readAuthForModel(model, config)
      .then(auth => {
        if (!auth.ok || auth.auth.type !== "apiKey") return null;
        return fetchQuota(apiKeyFromAuth(auth.auth));
      })
      .then(data => {
        if (!cancelled) setFetchedQuota(prev => prev ?? data);
      })
      .catch(() => {
        /* ignore errors, they're out-of-place in the menu */
      });
    return () => {
      cancelled = true;
    };
  }, [storeQuota, model, config]);
  const quota = storeQuota ?? fetchedQuota;
  if (!quota) return null;
  if (!quota.weeklyTokenLimit && !quota.rollingFiveHourLimit) return null;
  return (
    <Div
      style={{
        display: "flex",
        whiteSpace: "pre-wrap",
        flexDirection: "column",
        alignItems: "center",
      }}
    >
      <Span
        style={{
          fontWeight: "bold",
        }}
      >
        Synthetic Quota
      </Span>
      <Div
        style={{
          display: "flex",
          whiteSpace: "pre-wrap",
          flexDirection: "column",
        }}
      >
        {quota.weeklyTokenLimit ? (
          <WeeklyQuotaRow label="Weekly credits" entry={quota.weeklyTokenLimit} />
        ) : null}
        {quota.rollingFiveHourLimit ? (
          <QuotaRow label="5h request limit" entry={quota.rollingFiveHourLimit} />
        ) : null}
      </Div>
    </Div>
  );
};
