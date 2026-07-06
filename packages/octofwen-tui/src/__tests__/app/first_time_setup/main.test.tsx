import { describe, expect, test } from "bun:test";
import { FirstTimeSetup } from "../../../app/first_time_setup/main.tsx";

describe("terminal first-time setup", () => {
	test("exports the first-time setup component", () => {
		expect(FirstTimeSetup).toBeFunction();
	});
});
