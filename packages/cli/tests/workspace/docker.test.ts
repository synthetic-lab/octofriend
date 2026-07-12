import { describe, expect, test } from "bun:test";
import { managedDockerRunArgs } from "../../src/workspace/docker.ts";

describe("managedDockerRunArgs", () => {
	test("auto-removes managed containers", () => {
		const args = ["-d", "alpine"];

		expect(managedDockerRunArgs(args)).toEqual(["--rm", ...args]);
		expect(args).toEqual(["-d", "alpine"]);
	});

	test.each([
		["--rm"],
		["--rm=true"],
	])("preserves an explicit %s option", (option) => {
		const args = [option, "alpine"];

		expect(managedDockerRunArgs(args)).toEqual(args);
	});
});
