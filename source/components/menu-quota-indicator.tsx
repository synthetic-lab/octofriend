import React, { useEffect, useState } from "react";
import { Text, Box } from "ink";
import { assertKeyForModel, useConfig } from "../config.ts";
import { useModel } from "../state.ts";
import { t } from "structural";
import { formatTimeUntil } from "../time.ts";

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
        <Text color="gray">Synthetic Subscription</Text>
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
