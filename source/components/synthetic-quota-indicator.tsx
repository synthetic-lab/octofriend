import React, { createContext, useContext, useEffect, useState, useRef } from "react";
import { Text, Box } from "ink";
import { useConfig, assertKeyForModel } from "../config.ts";
import { useModel } from "../state.ts";
import { providerForBaseUrl, SYNTHETIC_PROVIDER } from "../providers.ts";
import { t } from "structural";

const QuotaEntryHeaderSchema = t.subtype({
  limit: t.num,
  requests: t.num,
  renewsAt: t.str,
});

const QuotaHeaderSchema = t.subtype({
  subscription: QuotaEntryHeaderSchema,
  search: t.subtype({
    hourly: QuotaEntryHeaderSchema,
  }),
  toolCallDiscounts: QuotaEntryHeaderSchema,
});

type QuotaResponse = t.GetType<typeof QuotaHeaderSchema>;

type QuotaEntry = {
  used: number;
  limit: number;
  renewsAt: Date | null;
};

const DEFAULT_QUOTA_ENTRY: QuotaEntry = { used: 0, limit: 0, renewsAt: null };

type QuotaData = {
  subscription: QuotaEntry;
  loading: boolean;
  error: boolean;
};

export type { QuotaData };

type QuotaContextValue = {
  quotaData: QuotaData | null;
  setQuotaData: (data: QuotaData) => void;
  lastUpdated: number | null;
};

const QuotaContext = createContext<QuotaContextValue | null>(null);

export function QuotaProvider({ children }: { children: React.ReactNode }) {
  const config = useConfig();
  const model = useModel();
  const [quotaData, setQuotaData] = useState<QuotaData | null>(null);
  const [lastUpdated, setLastUpdated] = useState<number | null>(null);
  const provider = providerForBaseUrl(model.baseUrl);
  const isSynthetic = provider === SYNTHETIC_PROVIDER;
  const isFetchingRef = useRef(false);

  const updateQuota = (data: QuotaData) => {
    if (isSynthetic) {
      setQuotaData(data);
      setLastUpdated(Date.now());
    }
  };

  const loadQuota = async () => {
    if (!isSynthetic || isFetchingRef.current) return;

    isFetchingRef.current = true;
    try {
      const apiKey = await assertKeyForModel(model, config);
      const data = await fetchQuota(apiKey);
      updateQuota(data);
    } catch {
      // Silently fail - the quota indicator just won't show
    } finally {
      isFetchingRef.current = false;
    }
  };

  // Subscribe to module-level quota manager for header-based updates
  useEffect(() => {
    if (!isSynthetic) return;
    const unsubscribe = quotaManager.subscribe(updateQuota);
    return unsubscribe;
  }, [isSynthetic]);

  // Initial poll on mount (so we have data right away)
  useEffect(() => {
    loadQuota();
  }, [isSynthetic, model.baseUrl, config]);

  // Background refresh every 5 minutes if data is stale
  useEffect(() => {
    if (!isSynthetic || !lastUpdated) return;

    const interval = setInterval(
      () => {
        const age = Date.now() - lastUpdated;
        const STALE_THRESHOLD = 5 * 60 * 1000; // 5 minutes

        if (age > STALE_THRESHOLD) {
          loadQuota();
        }
      },
      5 * 60 * 1000,
    ); // Check every 5 minutes

    return () => clearInterval(interval);
  }, [isSynthetic, lastUpdated, model.baseUrl, config]);

  const contextValue: QuotaContextValue = {
    quotaData: isSynthetic ? quotaData : null,
    lastUpdated: isSynthetic ? lastUpdated : null,
    setQuotaData: updateQuota,
  };

  return <QuotaContext.Provider value={contextValue}>{children}</QuotaContext.Provider>;
}

export function useQuotaData(): QuotaData | null {
  const context = useContext(QuotaContext);
  if (!context) {
    return null;
  }
  return context.quotaData;
}

export function useSetQuotaData(): (data: QuotaData) => void {
  const context = useContext(QuotaContext);
  if (!context) {
    throw new Error("useSetQuotaData must be used within QuotaProvider");
  }
  return context.setQuotaData;
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
      loading: false,
      error: false,
    };
  } catch {
    return {
      subscription: DEFAULT_QUOTA_ENTRY,
      loading: false,
      error: true,
    };
  }
}

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

/**
 * Simplified quota display for the main menu.
 * Shows requests used/limit and refresh time.
 */
export const MenuQuotaIndicator = React.memo(({ quota }: { quota: QuotaData | null }) => {
  if (!quota || quota.loading || quota.error) return null;

  const subscription = quota.subscription;
  if (subscription.limit === 0) return null;

  const renewsAt = subscription.renewsAt;
  if (!renewsAt) return null;

  return (
    <Box flexDirection="column" alignItems="center">
      <Text>
        Synthetic Subscription: {subscription.used.toFixed(1)} / {subscription.limit.toFixed(0)}{" "}
        Requests Used
      </Text>
      <Text color="gray">Limits refresh {formatTimeUntil(renewsAt)}</Text>
    </Box>
  );
});

/**
 * Module-level quota manager for updating quota data from API headers.
 * This allows the transport layer to update quota data without React dependencies.
 */
const quotaManager = {
  currentData: null as QuotaData | null,
  lastUpdated: null as number | null,
  listeners: new Set<(data: QuotaData) => void>(),

  setData(data: QuotaData) {
    this.currentData = data;
    this.lastUpdated = Date.now();
    this.listeners.forEach(listener => listener(data));
  },

  subscribe(listener: (data: QuotaData) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  },
};

export function updateQuotaFromHeader(headerValue: string): void {
  try {
    const parsed = JSON.parse(headerValue);
    const validated = QuotaHeaderSchema.slice(parsed);

    if (validated instanceof t.Err) {
      return;
    }

    const data: QuotaData = {
      subscription: {
        used: validated.subscription.requests,
        limit: validated.subscription.limit,
        renewsAt: new Date(validated.subscription.renewsAt),
      },
      loading: false,
      error: false,
    };

    quotaManager.setData(data);
  } catch {}
}
