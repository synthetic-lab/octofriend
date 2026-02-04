import React, { useEffect, useState, useRef } from "react";
import { Text } from "ink";
import { useConfig, assertKeyForModel } from "../config.ts";
import { useModel } from "../state.ts";
import { providerForBaseUrl, SYNTHETIC_PROVIDER } from "../providers.ts";

type QuotaResponseEntry = {
  limit: number;
  requests: number;
  renewsAt: string;
};

type QuotaResponse = {
  subscription: QuotaResponseEntry;
  search: {
    hourly: QuotaResponseEntry;
  };
  toolCallDiscounts: QuotaResponseEntry;
};

type QuotaEntry = {
  used: number;
  limit: number;
  renewsAt: Date | null;
};

const DEFAULT_QUOTA_ENTRY: QuotaEntry = { used: 0, limit: 0, renewsAt: null };

type QuotaData = {
  subscription: QuotaEntry;
  search: QuotaEntry;
  toolCallDiscounts: QuotaEntry;
  loading: boolean;
  error: boolean;
};

export type { QuotaData };

export function useSyntheticQuotaData(refreshTrigger: number): QuotaData | null {
  const config = useConfig();
  const model = useModel();
  const [quota, setQuota] = useState<QuotaData>({
    subscription: DEFAULT_QUOTA_ENTRY,
    search: DEFAULT_QUOTA_ENTRY,
    toolCallDiscounts: DEFAULT_QUOTA_ENTRY,
    loading: true,
    error: false,
  });
  const isFetchingRef = useRef(false);

  const provider = providerForBaseUrl(model.baseUrl);
  const isSynthetic = provider === SYNTHETIC_PROVIDER;

  const loadQuota = async () => {
    if (!isSynthetic || isFetchingRef.current) return;

    isFetchingRef.current = true;
    try {
      const apiKey = await assertKeyForModel(model, config);
      const quotaData = await fetchQuota(apiKey);
      setQuota(quotaData);
    } catch {
      setQuota(prev => ({ ...prev, loading: false, error: true }));
    } finally {
      isFetchingRef.current = false;
    }
  };

  useEffect(() => {
    loadQuota();
  }, [isSynthetic, model.baseUrl, config, refreshTrigger]);

  return isSynthetic ? quota : null;
}

async function fetchQuota(apiKey: string): Promise<QuotaData> {
  try {
    const response = await fetch("https://api.synthetic.new/v2/quotas", {
      headers: {
        Authorization: `Bearer ${apiKey}`,
      },
    });

    if (!response.ok) {
      return {
        subscription: DEFAULT_QUOTA_ENTRY,
        search: DEFAULT_QUOTA_ENTRY,
        toolCallDiscounts: DEFAULT_QUOTA_ENTRY,
        loading: false,
        error: true,
      };
    }

    const data: QuotaResponse = await response.json();
    return {
      subscription: {
        used: data.subscription.requests,
        limit: data.subscription.limit,
        renewsAt: new Date(data.subscription.renewsAt),
      },
      search: {
        used: data.search.hourly.requests,
        limit: data.search.hourly.limit,
        renewsAt: new Date(data.search.hourly.renewsAt),
      },
      toolCallDiscounts: {
        used: data.toolCallDiscounts.requests,
        limit: data.toolCallDiscounts.limit,
        renewsAt: new Date(data.toolCallDiscounts.renewsAt),
      },
      loading: false,
      error: false,
    };
  } catch {
    return {
      subscription: DEFAULT_QUOTA_ENTRY,
      search: DEFAULT_QUOTA_ENTRY,
      toolCallDiscounts: DEFAULT_QUOTA_ENTRY,
      loading: false,
      error: true,
    };
  }
}

function formatRenewsAt(date: Date): string {
  const hours = date.getHours();
  const minutes = date.getMinutes();
  const ampm = hours >= 12 ? "pm" : "am";
  const displayHours = hours % 12 || 12;
  const displayMinutes = minutes.toString().padStart(2, "0");
  return `${displayHours}:${displayMinutes}${ampm}`;
}

function QuotaLabel({ label, quota }: { label: string; quota: QuotaEntry }) {
  const isFull = quota.used >= quota.limit;

  if (isFull && quota.renewsAt) {
    return (
      <Text>
        {label}:{formatRenewsAt(quota.renewsAt)}
      </Text>
    );
  }

  const usedDisplay = quota.limit > 0 ? quota.used.toFixed(0) : "0";

  return (
    <Text>
      {label}:{usedDisplay}/{quota.limit.toFixed(0)}
    </Text>
  );
}

export const SyntheticQuotaIndicator = React.memo(({ quota }: { quota: QuotaData | null }) => {
  if (!quota || quota.loading || quota.error) return null;

  return (
    <Text color="gray">
      <QuotaLabel label="R" quota={quota.subscription} />{" "}
      <QuotaLabel label="S" quota={quota.search} />{" "}
      <QuotaLabel label="T" quota={quota.toolCallDiscounts} />
    </Text>
  );
});

export const useQuotaRefresh = () => {
  const [refreshTrigger, setRefreshTrigger] = useState(0);

  return {
    refreshTrigger,
    triggerRefresh: () => setRefreshTrigger(prev => prev + 1),
  };
};

/**
 * Hook that combines quota data fetching with mode change detection.
 * Automatically refreshes quota when the app transitions to "input" mode.
 */
export function useSyntheticQuotaWithModeRefresh(currentMode: string): QuotaData | null {
  const [refreshTrigger, setRefreshTrigger] = useState(0);
  const prevModeRef = useRef<string | null>(null);
  const refreshTriggeredRef = useRef(false);

  useEffect(() => {
    const previousMode = prevModeRef.current;

    if (currentMode === "input" && previousMode !== "input") {
      if (!refreshTriggeredRef.current) {
        refreshTriggeredRef.current = true;
        setRefreshTrigger(prev => prev + 1);
      }
    } else if (currentMode !== "input") {
      refreshTriggeredRef.current = false;
    }

    prevModeRef.current = currentMode;
  }, [currentMode]);

  return useSyntheticQuotaData(refreshTrigger);
}
