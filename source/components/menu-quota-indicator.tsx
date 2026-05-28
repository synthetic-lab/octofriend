import React, { useEffect, useState } from "react";
import { Text, Box } from "ink";
import { assertKeyForModel, useConfig } from "../config.ts";
import { useModel, useAppStore } from "../state.ts";
import type { QuotaData, QuotaEntry, WeeklyEntry } from "../utils/quota.ts";
import { parseQuotaJson } from "../utils/quota.ts";
import { formatTimeUntil } from "../time.ts";

async function fetchQuota(apiKey: string): Promise<QuotaData | null> {
  try {
    const response = await fetch("https://api.synthetic.new/v2/quotas", {
      headers: { Authorization: `Bearer ${apiKey}` },
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
    <Box flexDirection="column">
      <Text>{`${label}: ${formatQuotaNumber(entry.remaining)} / ${formatQuotaNumber(entry.max)} remaining`}</Text>
      {showNextRegen ? (
        <Text color="gray">{`Next regen: ${tickPercent}% ${formatTimeUntil(entry.nextTickAt)}`}</Text>
      ) : null}
    </Box>
  );
}

type WeeklyQuotaRowProps = {
  label: string;
  entry: WeeklyEntry;
};

function WeeklyQuotaRow({ label, entry }: WeeklyQuotaRowProps) {
  const showNextRegen = entry.remainingCredits !== entry.maxCredits;

  return (
    <Box flexDirection="column">
      <Text>{`${label}: ${entry.remainingCredits} / ${entry.maxCredits} remaining`}</Text>
      {showNextRegen ? (
        <Text color="gray">
          {`Next regen: ${entry.nextRegenCredits} ${formatTimeUntil(entry.nextRegenAt)}`}
        </Text>
      ) : null}
    </Box>
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
    assertKeyForModel(model, config)
      .then(apiKey => fetchQuota(apiKey))
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
    <Box flexDirection="column" alignItems="center">
      <Text bold>Synthetic Quota</Text>
      <Box flexDirection="column">
        {quota.weeklyTokenLimit ? (
          <WeeklyQuotaRow label="Weekly credits" entry={quota.weeklyTokenLimit} />
        ) : null}
        {quota.rollingFiveHourLimit ? (
          <QuotaRow label="5h request limit" entry={quota.rollingFiveHourLimit} />
        ) : null}
      </Box>
    </Box>
  );
};
