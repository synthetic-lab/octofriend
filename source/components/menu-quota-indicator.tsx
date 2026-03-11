import React, { useEffect, useState } from "react";
import { Text, Box } from "ink";
import { assertKeyForModel, useConfig } from "../config.ts";
import { useModel, useAppStore } from "../state.ts";
import { QuotaData, QuotaEntry } from "../utils/quota.ts";
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

function QuotaRow({ label, entry }: QuotaRowProps) {
  return (
    <Box flexDirection="row" flexWrap="wrap">
      <Text>{`${label}: ${entry.used} / ${entry.limit}`}</Text>
      <Text color="gray">{` · refreshes ${formatTimeUntil(entry.renewsAt)}`}</Text>
    </Box>
  );
}

export const MenuQuotaIndicator = React.memo(() => {
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

  return (
    <Box flexDirection="column" alignItems="center">
      <Text bold>Synthetic Subscription</Text>
      <Box flexDirection="column">
        <QuotaRow label="Requests" entry={quota.subscription} />
        {quota.freeToolCalls && quota.freeToolCalls.limit > 0 && (
          <QuotaRow label="Free Tool Calls" entry={quota.freeToolCalls} />
        )}
      </Box>
    </Box>
  );
});
