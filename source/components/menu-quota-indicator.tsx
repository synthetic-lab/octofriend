import React, { useEffect, useState } from "react";
import { Text, Box } from "ink";
import { assertKeyForModel, useConfig } from "../config.ts";
import { useModel, useAppStore } from "../state.ts";
import { QuotaData, RequestUsage, TokenUsage } from "../utils/quota.ts";
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
  renewsAt: Date;
  usage: string;
};

function QuotaRow({ label, renewsAt, usage }: QuotaRowProps) {
  return (
    <Box flexDirection="row" flexWrap="wrap">
      <Text>{`${label}: ${usage}`}</Text>
      <Text color="gray">{` · refreshes ${formatTimeUntil(renewsAt)}`}</Text>
    </Box>
  );
}

function formatRequestUsage(requestUsage: RequestUsage): string {
  return `${requestUsage.used} / ${requestUsage.limit}`;
}

function formatTokenUsage(tokenUsage: TokenUsage): string {
  return `${Math.round((tokenUsage.current / tokenUsage.limit) * 100)}%`;
}

function formatWeeklyTokenLimit(input: TokenUsage, output: TokenUsage): string {
  return `${formatTokenUsage(input)} input, ${formatTokenUsage(output)} output`;
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
        <QuotaRow
          label="Requests"
          renewsAt={quota.subscription.renewsAt}
          usage={formatRequestUsage(quota.subscription)}
        />
        {quota.freeToolCalls && quota.freeToolCalls.limit > 0 && (
          <QuotaRow
            label="Free Tool Calls"
            renewsAt={quota.freeToolCalls.renewsAt}
            usage={formatRequestUsage(quota.freeToolCalls)}
          />
        )}
        {quota.weeklyTokenLimit && (
          <QuotaRow
            label="Tokens"
            renewsAt={quota.weeklyTokenLimit.renewsAt}
            usage={formatWeeklyTokenLimit(
              quota.weeklyTokenLimit.input,
              quota.weeklyTokenLimit.output,
            )}
          />
        )}
      </Box>
    </Box>
  );
});
