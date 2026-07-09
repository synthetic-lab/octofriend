import { useEffect, useRef, useState } from "react";

const VERSION_CHECK_CLEAR_DELAY = 5000;
const NEW_VERSION_MESSAGE =
	"New version released! Run `bun install --global octofwen` to update.";
const CURRENT_VERSION_MESSAGE = "Octo is up-to-date.";

export function useVersionCheck(currentVersion: string): string {
	const [versionCheck, setVersionCheck] = useState("Checking for updates...");
	const versionCheckRunRef = useRef(0);
	const versionClearTimerRef = useRef<
		ReturnType<typeof setTimeout> | undefined
	>(undefined);

	useEffect(() => {
		versionCheckRunRef.current += 1;
		const currentRun = versionCheckRunRef.current;
		if (versionClearTimerRef.current !== undefined) {
			clearTimeout(versionClearTimerRef.current);
			versionClearTimerRef.current = undefined;
		}

		getLatestVersion().then((latestVersion) => {
			if (versionCheckRunRef.current !== currentRun) return;
			const versionMessage = bottomBarVersionMessage(
				currentVersion,
				latestVersion,
			);
			setVersionCheck(versionMessage);
			if (versionMessage === NEW_VERSION_MESSAGE) return;
			versionClearTimerRef.current = setTimeout(() => {
				if (versionCheckRunRef.current !== currentRun) return;
				versionClearTimerRef.current = undefined;
				setVersionCheck("");
			}, VERSION_CHECK_CLEAR_DELAY);
		});

		return () => {
			versionCheckRunRef.current += 1;
			if (versionClearTimerRef.current !== undefined) {
				clearTimeout(versionClearTimerRef.current);
				versionClearTimerRef.current = undefined;
			}
		};
	}, [currentVersion]);

	return versionCheck;
}

export function bottomBarVersionMessage(
	currentVersion: string,
	latestVersion: string | null,
): string {
	return latestVersion && isVersionNewer(currentVersion, latestVersion)
		? NEW_VERSION_MESSAGE
		: CURRENT_VERSION_MESSAGE;
}

function isVersionNewer(
	currentVersion: string,
	latestVersion: string,
): boolean {
	const current = parseNumericVersion(currentVersion);
	const latest = parseNumericVersion(latestVersion);
	if (!(current && latest)) return currentVersion < latestVersion;
	for (let index = 0; index < current.length; index += 1) {
		if (latest[index] !== current[index]) return latest[index] > current[index];
	}
	return false;
}

function parseNumericVersion(version: string): [number, number, number] | null {
	const start = version.charCodeAt(0) === 118 ? 1 : 0;
	const firstDot = version.indexOf(".", start);
	if (firstDot === -1) return null;
	const secondDot = version.indexOf(".", firstDot + 1);
	if (secondDot === -1 || version.indexOf(".", secondDot + 1) !== -1) {
		return null;
	}
	const major = parseVersionPart(version, start, firstDot);
	const minor = parseVersionPart(version, firstDot + 1, secondDot);
	const patch = parseVersionPart(version, secondDot + 1, version.length);
	return major === null || minor === null || patch === null
		? null
		: [major, minor, patch];
}

function parseVersionPart(
	value: string,
	start: number,
	end: number,
): number | null {
	if (start >= end) return null;
	let parsed = 0;
	let index = start;
	while (index < end) {
		const digit = value.charCodeAt(index) - 48;
		if (digit < 0 || digit > 9) return null;
		parsed = parsed * 10 + digit;
		if (!Number.isSafeInteger(parsed)) return null;
		index += 1;
	}
	return parsed;
}

export async function getLatestVersion() {
	try {
		const response = await fetch("https://registry.npmjs.com/octofwen");
		const contents = await response.json();
		return packageLatestVersion(contents);
	} catch {
		return null;
	}
}

function packageLatestVersion(contents: unknown): string | null {
	if (typeof contents !== "object" || contents === null) return null;
	const distTags = (contents as Record<string, unknown>)["dist-tags"];
	if (typeof distTags !== "object" || distTags === null) return null;
	const latest = (distTags as Record<string, unknown>)["latest"];
	return typeof latest === "string" ? latest : null;
}
