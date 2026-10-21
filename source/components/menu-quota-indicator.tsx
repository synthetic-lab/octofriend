import React, { useEffect, useState } from "react";
import { apiKeyFromAuth, readAuthForModel, useConfig } from "../config.ts";
import { useModel, useAppStore } from "../state.ts";
import type { QuotaData, QuotaEntry, WeeklyEntry } from "../utils/quota.ts";
import { parseQuotaJson } from "../utils/quota.ts";
import { formatTimeUntilLong, formatTimeUntilNarrow } from "../time.ts";
import {
  BACKGROUND_COLOR,
  FOREGROUND_COLOR,
  QUOTA_BAR_TRACK_COLOR,
  QUOTA_DETAIL_COLOR,
  useColor,
} from "../theme.ts";
import { Div, Span } from "paintcannon-react";
import { TerminalFlex } from "./terminal-flex.tsx";

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
    <TerminalFlex
      style={{
        flexDirection: "column",
      }}
    >
      <Span>{`${label}: ${formatQuotaNumber(entry.remaining)} / ${formatQuotaNumber(entry.max)} remaining`}</Span>
      {showNextRegen ? (
        <Span
          style={{
            color: "gray",
          }}
        >{`Next regen: ${tickPercent}% ${formatTimeUntilLong(entry.nextTickAt)}`}</Span>
      ) : null}
    </TerminalFlex>
  );
}
type WeeklyQuotaRowProps = {
  label: string;
  entry: WeeklyEntry;
  display: "credits" | "percentage";
};
function WeeklyQuotaRow({ label, entry, display }: WeeklyQuotaRowProps) {
  const themeColor = useColor();
  const showNextRegen = entry.percentRemaining < 100;
  if (display === "credits") {
    return (
      <TerminalFlex style={{ flexDirection: "column" }}>
        <Span>{`${label}: ${entry.remainingCredits} / ${entry.maxCredits} remaining`}</Span>
        {showNextRegen && (
          <Span style={{ color: "gray" }}>
            {`Next regen: ${entry.nextRegenCredits} ${formatTimeUntilLong(entry.nextRegenAt)}`}
          </Span>
        )}
      </TerminalFlex>
    );
  }
  const remainingLabel = `${entry.percentRemaining.toFixed(2)}% left`;
  const maxCredits = Number(entry.maxCredits.replace("$", ""));
  const nextRegenCredits = Number(entry.nextRegenCredits.replace("$", ""));
  const regenPercent = Number(((nextRegenCredits / maxCredits) * 100).toFixed(2));
  return (
    <TerminalFlex
      style={{
        flexDirection: "column",
        paddingLeft: 2,
        paddingRight: 2,
      }}
    >
      <TerminalFlex style={{ justifyContent: "center", color: FOREGROUND_COLOR, marginBottom: 1 }}>
        <Span>{label}</Span>
      </TerminalFlex>
      <TerminalFlex style={{ position: "relative", height: 1 }}>
        <TerminalFlex
          style={{
            position: "absolute",
            left: 0,
            top: 0,
            width: "100%",
            height: 1,
            border: "pill",
            borderColor: QUOTA_BAR_TRACK_COLOR,
            backgroundColor: QUOTA_BAR_TRACK_COLOR,
            justifyContent: "center",
            color: FOREGROUND_COLOR,
          }}
        >
          <Span style={{ fontWeight: "bold" }}>{remainingLabel}</Span>
        </TerminalFlex>
        <Div
          style={{
            width: `${Math.max(0, Math.min(100, entry.percentRemaining))}%`,
            height: 1,
            overflow: "hidden",
          }}
        >
          <TerminalFlex
            style={{
              position: "absolute",
              left: 0,
              top: 0,
              width: "100%",
              height: 1,
              border: "pill",
              borderColor: themeColor,
              backgroundColor: themeColor,
              justifyContent: "center",
              color: BACKGROUND_COLOR,
            }}
          >
            <Span style={{ fontWeight: "bold" }}>{remainingLabel}</Span>
          </TerminalFlex>
        </Div>
      </TerminalFlex>
      <TerminalFlex
        style={{
          justifyContent: "space-between",
          flexWrap: "wrap",
          columnGap: 2,
          paddingLeft: 1,
          paddingRight: 1,
          color: QUOTA_DETAIL_COLOR,
        }}
      >
        {showNextRegen ? (
          <>
            <Span>Next regen</Span>
            <Span>{`+${regenPercent}% ${formatTimeUntilNarrow(entry.nextRegenAt, new Date())}`}</Span>
          </>
        ) : (
          <Span>All credits available</Span>
        )}
      </TerminalFlex>
    </TerminalFlex>
  );
}
export const MenuQuotaIndicator = () => {
  const config = useConfig();
  const model = useModel();
  const storeQuota = useAppStore(state => state.quotaData);
  const [fetchedQuota, setFetchedQuota] = useState<QuotaData | null>(null);
  const [fetchFailed, setFetchFailed] = useState(false);

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
        if (cancelled) return;
        if (data == null) {
          setFetchFailed(true);
          return;
        }
        setFetchedQuota(prev => prev ?? data);
      })
      .catch(() => {
        if (!cancelled) setFetchFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [storeQuota, model, config]);
  const quota = storeQuota ?? fetchedQuota;
  if (quota == null) {
    return (
      <TerminalFlex>
        <Span
          style={{
            color: "gray",
          }}
        >
          {fetchFailed ? "Could not load usage information." : "Loading usage..."}
        </Span>
      </TerminalFlex>
    );
  }
  if (!quota.weeklyTokenLimit && !quota.rollingFiveHourLimit) {
    return (
      <TerminalFlex>
        <Span
          style={{
            color: "gray",
          }}
        >
          No usage limits currently apply.
        </Span>
      </TerminalFlex>
    );
  }
  const weeklyDisplay = quota.rollingFiveHourLimit ? "credits" : "percentage";
  return (
    <TerminalFlex
      style={{
        flexDirection: "column",
      }}
    >
      {quota.weeklyTokenLimit ? (
        <WeeklyQuotaRow
          label="Weekly credits"
          entry={quota.weeklyTokenLimit}
          display={weeklyDisplay}
        />
      ) : null}
      {quota.rollingFiveHourLimit ? (
        <QuotaRow label="5h request limit" entry={quota.rollingFiveHourLimit} />
      ) : null}
    </TerminalFlex>
  );
};
