import { Box, Text } from "ink";
import { createContext, useContext, useEffect, useState } from "react";
import {
	formatTimeUntil,
	normalizeQuotaData,
	type QuotaData,
	type QuotaEntry,
	type WeeklyEntry,
} from "../app/state/quota.ts";
import { assertKeyForModel } from "../internal/configuration/keys.ts";
import type { Config, ModelConfig } from "../internal/configuration/schemas.ts";

export type QuotaModel = Pick<ModelConfig, "apiEnvVar" | "auth" | "baseUrl">;

export type SyntheticQuotaFetcher = (params: {
	apiKey: string;
}) => Promise<{ quota: unknown | null }>;

export const SyntheticQuotaFetchContext =
	createContext<SyntheticQuotaFetcher | null>(null);

export type MenuQuotaIndicatorProps = {
	config?: Config | null;
	model?: QuotaModel;
	quota: QuotaData | null | undefined;
};

export function formatQuotaNumber(value: number): string {
	if (Number.isInteger(value)) return value.toString();
	return `${Math.floor(value * 10) / 10}`;
}

type QuotaRowProps = {
	label: string;
	entry: QuotaEntry;
};

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

export function MenuQuotaIndicator({
	config = null,
	model,
	quota: storeQuota,
}: MenuQuotaIndicatorProps) {
	const [fetchedQuota, setFetchedQuota] = useState<QuotaData | null>(null);
	const syntheticQuotaFetch = useContext(SyntheticQuotaFetchContext);

	// Used when the menu opens before the agent has received quota headers.
	// Otherwise the caller-provided quota should come from the app store.
	useEffect(() => {
		if (storeQuota || !model || !syntheticQuotaFetch) return;
		let cancelled = false;
		assertKeyForModel(model, config)
			.then((apiKey) => syntheticQuotaFetch({ apiKey }))
			.then((result) => {
				const quota = normalizeQuotaData(result.quota);
				if (!cancelled) setFetchedQuota((prev) => prev ?? quota ?? null);
			})
			.catch(() => {
				// Quota fetch failures are intentionally not surfaced in the menu.
			});
		return () => {
			cancelled = true;
		};
	}, [storeQuota, model, config, syntheticQuotaFetch]);

	const quota = storeQuota ?? fetchedQuota;

	if (!quota) return null;
	if (!(quota.weeklyTokenLimit || quota.rollingFiveHourLimit)) return null;

	return (
		<Box flexDirection="column" alignItems="center">
			<Text bold={true}>Synthetic Quota</Text>
			<Box flexDirection="column">
				{quota.weeklyTokenLimit ? (
					<WeeklyQuotaRow
						label="Weekly credits"
						entry={quota.weeklyTokenLimit}
					/>
				) : null}
				{quota.rollingFiveHourLimit ? (
					<QuotaRow
						label="5h request limit"
						entry={quota.rollingFiveHourLimit}
					/>
				) : null}
			</Box>
		</Box>
	);
}
