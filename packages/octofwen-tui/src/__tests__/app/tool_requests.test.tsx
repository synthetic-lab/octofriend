import { describe, expect, it } from "bun:test";
import {
	ToolRequestRenderer,
	ToolRequestsRenderer,
} from "../../app/tool_requests.tsx";

describe("terminal tool request rendering", () => {
	it("exports the terminal tool request components", () => {
		expect(ToolRequestsRenderer).toBeFunction();
		expect(ToolRequestRenderer).toBeFunction();
	});
});
