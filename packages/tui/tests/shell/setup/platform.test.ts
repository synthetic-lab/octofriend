import { describe, expect, it } from "bun:test";
import {
	getPlatform,
	isLinux,
	isMacOS,
	isWindows,
	Platform,
	platformFromNodePlatform,
} from "../../../src/shell/setup/platform";

describe("host platform detection", () => {
	it("maps Node platform identifiers to stable platform keys", () => {
		expect(platformFromNodePlatform("win32")).toBe(Platform.windows);
		expect(platformFromNodePlatform("darwin")).toBe(Platform.macos);
		expect(platformFromNodePlatform("linux")).toBe(Platform.linux);
		expect(platformFromNodePlatform("freebsd")).toBe(Platform.other);
	});

	it("reports current platform helper booleans consistently", () => {
		const platform = getPlatform();

		expect(isWindows()).toBe(platform === Platform.windows);
		expect(isMacOS()).toBe(platform === Platform.macos);
		expect(isLinux()).toBe(platform === Platform.linux);
	});
});
