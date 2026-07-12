import { nonEmptyTrimmedText } from "../../shell/text-processing.ts";

type DefaultApiKeyOverrides = Record<string, string>;

type MergedDefaultApiKeyOverrides<
	TCurrent extends DefaultApiKeyOverrides | undefined,
> = TCurrent extends DefaultApiKeyOverrides
	? DefaultApiKeyOverrides
	: DefaultApiKeyOverrides | undefined;

export function mergeDefaultApiKeyOverrides<
	TCurrent extends DefaultApiKeyOverrides | undefined,
>(
	current: TCurrent,
	override: DefaultApiKeyOverrides,
): MergedDefaultApiKeyOverrides<TCurrent> {
	let next: DefaultApiKeyOverrides | undefined;
	for (const key in override) {
		if (!Object.hasOwn(override, key)) continue;
		const overrideRawValue = override[key];
		if (overrideRawValue === undefined) continue;
		const overrideValue = nonEmptyTrimmedText(overrideRawValue);
		if (overrideValue === null) continue;
		if (current?.[key] === overrideValue) continue;
		if (next === undefined) next = cloneOwnOverrides(current);
		setOwnOverride(next, key, overrideValue);
	}
	return (next ?? current) as MergedDefaultApiKeyOverrides<TCurrent>;
}

function cloneOwnOverrides(
	current: DefaultApiKeyOverrides | undefined,
): DefaultApiKeyOverrides {
	const next: DefaultApiKeyOverrides = {};
	if (current === undefined) return next;
	for (const key in current) {
		if (!Object.hasOwn(current, key)) continue;
		const value = nonEmptyTrimmedText(current[key]);
		if (value !== null) setOwnOverride(next, key, value);
	}
	return next;
}

function setOwnOverride(
	target: DefaultApiKeyOverrides,
	key: string,
	value: string,
): void {
	if (key === "__proto__") {
		Object.defineProperty(target, key, {
			value,
			writable: true,
			enumerable: true,
			configurable: true,
		});
		return;
	}
	target[key] = value;
}
