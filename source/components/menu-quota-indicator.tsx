import React, { useEffect, useState } from "react";
import { Text, Box } from "ink";
import { assertKeyForModel, useConfig } from "../config.ts";
import { useModel } from "../state.ts";
import { t } from "structural";

const QuotaResponseSchema = t.subtype({
  subscription: t.subtype({
    limit: t.num,
    requests: t.num,
    renewsAt: t.str,
  }),
});

type QuotaResponse = t.GetType<typeof QuotaResponseSchema>;

type QuotaData = {
  used: number;
  limit: number;
  renewsAt: Date;
};

function formatTimeUntil(renewsAt: Date): string {
  const now = new Date();
  const diffMs = renewsAt.getTime() - now.getTime();
  const diffMins = Math.floor(diffMs / (1000 * 60));

  if (diffMins < 60) {
    return `in ${diffMins} minute${diffMins !== 1 ? "s" : ""}`;
  }

  const diffHours = Math.floor(diffMins / 60);
  const remainingMins = diffMins % 60;

  if (diffHours < 24) {
    if (remainingMins > 0) {
      return `in ${diffHours} hour${diffHours !== 1 ? "s" : ""} ${remainingMins} minute${remainingMins !== 1 ? "s" : ""}`;
    }
    return `in ${diffHours} hour${diffHours !== 1 ? "s" : ""}`;
  }

  const diffDays = Math.floor(diffHours / 24);
  const remainingHours = diffHours % 24;

  if (remainingHours > 0) {
    return `in ${diffDays} day${diffDays !== 1 ? "s" : ""} ${remainingHours} hour${remainingHours !== 1 ? "s" : ""}`;
  }
  return `in ${diffDays} day${diffDays !== 1 ? "s" : ""}`;
}

async function fetchQuota(apiKey: string): Promise<QuotaData | null> {
  try {
    const response = await fetch("https://api.synthetic.new/v2/quotas", {
      headers: {
        Authorization: `Bearer ${apiKey}`,
      },
    });

    if (!response.ok) return null;

    const data: QuotaResponse = await response.json();
    const validated = QuotaResponseSchema.slice(data);

    if (validated instanceof t.Err) return null;

    return {
      used: validated.subscription.requests,
      limit: validated.subscription.limit,
      renewsAt: new Date(validated.subscription.renewsAt),
    };
  } catch {
    return null;
  }
}

export const MenuQuotaIndicator = React.memo(() => {
  const config = useConfig();
  const model = useModel();
  const [quota, setQuota] = useState<QuotaData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    async function loadQuota() {
      try {
        const apiKey = await assertKeyForModel(model, config);
        const data = await fetchQuota(apiKey);
        if (!cancelled) {
          setQuota(data);
          setLoading(false);
        }
      } catch {
        if (!cancelled) {
          setQuota(null);
          setLoading(false);
        }
      }
    }

    loadQuota();

    return () => {
      cancelled = true;
    };
  }, [model, config]);

  if (loading) {
    return (
      <Box flexDirection="column" alignItems="center">
        <Text color="gray">Synthetic Subscription:</Text>
        <Text color="gray">Loading quota...</Text>
      </Box>
    );
  }

  if (!quota || quota.limit === 0) return null;

  return (
    <Box flexDirection="column" alignItems="center">
      <Text>
        Synthetic Subscription: {quota.used} / {quota.limit} Requests Used
      </Text>
      <Text color="gray">Limits refresh {formatTimeUntil(quota.renewsAt)}</Text>
    </Box>
  );
});
