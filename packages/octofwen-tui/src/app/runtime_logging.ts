const levelNames = ["verbose", "info"] as const;
export type LogLevel = (typeof levelNames)[number];

let level = process.env["OCTO_VERBOSE"] ? 0 : 1;

export function setLevel(newLevel: LogLevel): void {
	level = levelNames.indexOf(newLevel);
}

export function log(logLevel: LogLevel, ...args: unknown[]): void {
	const levelIndex = levelNames.indexOf(logLevel);
	if (levelIndex >= level) {
		console.log(...args);
	}
}

export function error(logLevel: LogLevel, ...args: unknown[]): void {
	const levelIndex = levelNames.indexOf(logLevel);
	if (levelIndex >= level) {
		console.error(...args);
	}
}

export function displayLog({
	info,
	verbose,
}: {
	info: string;
	verbose: string;
}): string {
	const currLevel = levelNames[level];
	if (currLevel === "verbose") return verbose;
	return info;
}
