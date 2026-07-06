import { describe, expect, test } from "bun:test";
import {
	AutofixSetup,
	autofixSetupFlow,
} from "../../../app/first_time_setup/autofix-setup.tsx";
import {
	FirstTimeSetup,
	firstTimeSetupFlow,
} from "../../../app/first_time_setup/main.tsx";

describe("terminal first-time setup", () => {
	test("exports router-backed first-time setup components", () => {
		expect(FirstTimeSetup).toBeFunction();
		expect(firstTimeSetupFlow.route).toBeFunction();
		expect(AutofixSetup).toBeFunction();
		expect(autofixSetupFlow.route).toBeFunction();
	});
});
