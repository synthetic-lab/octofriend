import { Box, Text } from "ink";
import { createContext, useContext, useEffect, useMemo, useState } from "react";
import { assertKeyForModel } from "../runtime/config/keys.ts";
import type { Config, ModelConfig } from "../runtime/config/schemas.ts";
import {
	formatTimeUntil,
	normalizeQuotaData,
	type QuotaData,
	type QuotaEntry,
	type WeeklyEntry,
} from "../shell/state/quota.ts";

export type QuotaModel = Pick<
	ModelConfig,
	"apiEnvVar" | "auth" | "baseUrl" | "type"
>;

export type SyntheticQuotaFetcher = (params: {
	apiKey: string;
}) => Promise<{ quota: unknown | null }>;

export const SyntheticQuotaFetchContext =
	createContext<SyntheticQuotaFetcher | null>(null);

type QuotaKeyReader = (
	model: QuotaModel,
	config: Config | null,
) => Promise<string>;

export type MenuQuotaIndicatorProps = {
	config?: Config | null;
	keyReader?: QuotaKeyReader;
	model?: QuotaModel;
	quota: QuotaData | null | undefined;
};

const defaultQuotaKeyReader: QuotaKeyReader = (model, config) =>
	assertKeyForModel(model, config);

function authSignature(auth: QuotaModel["auth"]): string {
	if (!auth) return "";
	if (auth.type === "env") {
		return `env:${auth.name}:${auth.credential ?? ""}`;
	}
	return `command:${auth.command.join("\0")}`;
}

function quotaModelSignature(model: QuotaModel | undefined): string {
	if (!model) return "";
	return `${model.type ?? ""}:${model.baseUrl}:${model.apiEnvVar ?? ""}:${authSignature(model.auth)}`;
}

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
	keyReader = defaultQuotaKeyReader,
	model,
	quota: storeQuota,
}: MenuQuotaIndicatorProps) {
	const [fetchedQuota, setFetchedQuota] = useState<QuotaData | null>(null);
	const syntheticQuotaFetch = useContext(SyntheticQuotaFetchContext);
	const modelSignature = useMemo(() => quotaModelSignature(model), [model]);

	// Used when the menu opens before the agent has received quota headers.
	// Otherwise the caller-provided quota should come from the app store.
	useEffect(() => {
		if (storeQuota || !model || !syntheticQuotaFetch) {
			setFetchedQuota(null);
			return;
		}
		let cancelled = false;
		setFetchedQuota(null);
		keyReader(model, config)
			.then((apiKey) => syntheticQuotaFetch({ apiKey }))
			.then((result) => {
				const quota = normalizeQuotaData(result.quota);
				if (!cancelled) setFetchedQuota(quota ?? null);
			})
			.catch(() => {
				// Quota fetch failures are intentionally not surfaced in the menu.
			});
		return () => {
			cancelled = true;
		};
	}, [storeQuota, modelSignature, config, syntheticQuotaFetch, keyReader]);

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
