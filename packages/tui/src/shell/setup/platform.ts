import os from "node:os";

export const Platform = {
	windows: "windows",
	macos: "macos",
	linux: "linux",
	other: "other",
} as const;

export type PlatformKey = (typeof Platform)[keyof typeof Platform];

const PLATFORM_MAP: Record<string, PlatformKey> = {
	win32: Platform.windows,
	darwin: Platform.macos,
	linux: Platform.linux,
};

export function platformFromNodePlatform(platform: string): PlatformKey {
	return PLATFORM_MAP[platform] ?? Platform.other;
}

export function getPlatform(): PlatformKey {
	return platformFromNodePlatform(os.platform());
}

export function isWindows(): boolean {
	return getPlatform() === Platform.windows;
}

export function isMacOS(): boolean {
	return getPlatform() === Platform.macos;
}

export function isLinux(): boolean {
	return getPlatform() === Platform.linux;
}
