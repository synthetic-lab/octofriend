import { describe, expect, it } from "bun:test";
import { render } from "ink-testing-library";
import {
	ShellToolRenderer,
	ToolMessageRenderer,
	WebSearchToolRenderer,
} from "../../rendering/tools.tsx";

describe("terminal tool rendering", () => {
	it("renders shell tool commands", () => {
		const { lastFrame } = render(
			<ShellToolRenderer
				item={{
					name: "shell",
					arguments: { cmd: "echo hello", timeout: 1000 },
				}}
			/>,
		);

		const output = lastFrame() || "";
		expect(output).toContain("shell");
		expect(output).toContain("echo hello");
		expect(output).toContain("1000");
	});

	it("renders web search tool activity", () => {
		const { lastFrame } = render(
			<WebSearchToolRenderer
				item={{ name: "web-search", arguments: { query: "octofwen" } }}
			/>,
		);

		expect(lastFrame() || "").toContain("Octo searched the web");
	});

	it("dispatches typed tool calls to the matching renderer", () => {
		const { lastFrame } = render(
			<ToolMessageRenderer
				item={
					{
						type: "tool-call",
						name: "shell",
						parsed: { cmd: "pwd", timeout: 5000 },
					} as never
				}
			/>,
		);

		const output = lastFrame() || "";
		expect(output).toContain("shell");
		expect(output).toContain("pwd");
	});
});
