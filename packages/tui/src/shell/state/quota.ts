export type QuotaEntry = {
	remaining: number;
	max: number;
	nextTickAt: Date;
	tickPercent: number;
};

export type WeeklyEntry = {
	nextRegenAt: Date;
	percentRemaining: number;
	maxCredits: string;
	remainingCredits: string;
	nextRegenCredits: string;
};

export type QuotaData = {
	rollingFiveHourLimit?: QuotaEntry;
	weeklyTokenLimit?: WeeklyEntry;
};

export function parseQuotaJson(data: string): QuotaData | undefined {
	try {
		return normalizeQuotaData(JSON.parse(data));
	} catch {
		return undefined;
	}
}

export function normalizeQuotaData(raw: unknown): QuotaData | undefined {
	if (raw == null || typeof raw !== "object" || Array.isArray(raw))
		return undefined;
	const record = raw as Record<string, unknown>;

	const rollingFiveHourLimit = parseOptionalQuotaEntry(
		record["rollingFiveHourLimit"],
	);
	const weeklyTokenLimit = parseOptionalWeeklyEntry(record["weeklyTokenLimit"]);
	if (!(rollingFiveHourLimit || weeklyTokenLimit)) return undefined;

	return {
		...(rollingFiveHourLimit ? { rollingFiveHourLimit } : {}),
		...(weeklyTokenLimit ? { weeklyTokenLimit } : {}),
	};
}

export function formatTimeUntil(
	expiresAt: Date,
	now: Date = new Date(),
): string {
	const diffMs = expiresAt.getTime() - now.getTime();
	if (diffMs <= 0) return "in 0 minutes";

	const diffMins = Math.max(1, Math.ceil(diffMs / (1000 * 60)));
	if (diffMins < 60) return `in ${formatUnit(diffMins, "minute")}`;

	const diffHours = Math.floor(diffMins / 60);
	const remainingMins = diffMins % 60;
	if (diffHours < 24) {
		return remainingMins > 0
			? `in ${formatUnit(diffHours, "hour")} ${formatUnit(remainingMins, "minute")}`
			: `in ${formatUnit(diffHours, "hour")}`;
	}

	const diffDays = Math.floor(diffHours / 24);
	const remainingHours = diffHours % 24;
	return remainingHours > 0
		? `in ${formatUnit(diffDays, "day")} ${formatUnit(remainingHours, "hour")}`
		: `in ${formatUnit(diffDays, "day")}`;
}

function parseOptionalQuotaEntry(raw: unknown): QuotaEntry | undefined {
	if (raw == null) return undefined;
	if (typeof raw !== "object" || Array.isArray(raw)) return undefined;
	const record = raw as Record<string, unknown>;
	const { remaining, max, nextTickAt: rawNextTickAt, tickPercent } = record;
	if (
		typeof remaining !== "number" ||
		typeof max !== "number" ||
		typeof rawNextTickAt !== "string" ||
		typeof tickPercent !== "number"
	) {
		return undefined;
	}
	const nextTickAt = parseDate(rawNextTickAt);
	if (!nextTickAt) return undefined;
	return { remaining, max, nextTickAt, tickPercent };
}

function parseOptionalWeeklyEntry(raw: unknown): WeeklyEntry | undefined {
	if (raw == null) return undefined;
	if (typeof raw !== "object" || Array.isArray(raw)) return undefined;
	const record = raw as Record<string, unknown>;
	const {
		nextRegenAt: rawNextRegenAt,
		percentRemaining,
		maxCredits,
		remainingCredits,
		nextRegenCredits,
	} = record;
	if (
		typeof rawNextRegenAt !== "string" ||
		typeof percentRemaining !== "number" ||
		typeof maxCredits !== "string" ||
		typeof remainingCredits !== "string" ||
		typeof nextRegenCredits !== "string"
	) {
		return undefined;
	}
	const nextRegenAt = parseDate(rawNextRegenAt);
	if (!nextRegenAt) return undefined;
	return {
		nextRegenAt,
		percentRemaining,
		maxCredits,
		remainingCredits,
		nextRegenCredits,
	};
}

function parseDate(value: string): Date | undefined {
	const date = new Date(value);
	return Number.isNaN(date.getTime()) ? undefined : date;
}

function formatUnit(value: number, unit: "minute" | "hour" | "day"): string {
	return `${value} ${unit}${value === 1 ? "" : "s"}`;
}
