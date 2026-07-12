import { describe, expect, it } from "bun:test";
import { render } from "ink-testing-library";
import {
	McpToolRenderer,
	ShellToolRenderer,
	ToolMessageRenderer,
	WebSearchToolRenderer,
	WhitelistAllowDescription,
} from "../../src/render/tools.tsx";
import { CwdContext } from "../../src/shell/workspace-context.tsx";

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

	it("normalizes tool argument line breaks before rendering", () => {
		const shell = render(
			<ShellToolRenderer
				item={{
					name: "shell",
					arguments: { cmd: "printf first\r\nsecond\rthird", timeout: 1000 },
				}}
			/>,
		);
		const shellOutput = shell.lastFrame() || "";
		expect(shellOutput).toContain("first");
		expect(shellOutput).toContain("second");
		expect(shellOutput).toContain("third");
		expect(shellOutput).not.toContain("\r");

		const mcp = render(
			<McpToolRenderer
				item={{
					name: "mcp",
					arguments: {
						server: "codebase\r\nmemory",
						tool: "search\rgraph",
						arguments: {},
					},
				}}
			/>,
		);
		const mcpOutput = mcp.lastFrame() || "";
		expect(mcpOutput).toContain("codebase");
		expect(mcpOutput).toContain("memory");
		expect(mcpOutput).toContain("search");
		expect(mcpOutput).toContain("graph");
		expect(mcpOutput).not.toContain("\r");
	});

	it("renders web search tool activity", () => {
		const { lastFrame } = render(
			<WebSearchToolRenderer
				item={{ name: "web-search", arguments: { query: "octofriend" } }}
			/>,
		);

		expect(lastFrame() || "").toContain("Octo searched the web");
	});

	it("renders mcp tool arguments", () => {
		const { lastFrame } = render(
			<McpToolRenderer
				item={{
					name: "mcp",
					arguments: {
						server: "codebase",
						tool: "search",
						arguments: { query: "rendering tools" },
					},
				}}
			/>,
		);

		const output = lastFrame() || "";
		expect(output).toContain("Server: codebase, Tool: search");
		expect(output).toContain('Arguments: {"query":"rendering tools"}');
	});

	it("updates mcp tool arguments when the parsed object mutates in place", () => {
		const item = {
			name: "mcp",
			arguments: {
				server: "codebase",
				tool: "search",
				arguments: { query: "old" },
			},
		};
		const instance = render(<McpToolRenderer item={item} />);

		item.arguments.arguments.query = "new";
		instance.rerender(<McpToolRenderer item={item} />);

		expect(instance.lastFrame() || "").toContain('Arguments: {"query":"new"}');
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

	it("renders whitelist descriptions for parsed and static tool types", () => {
		const shell = render(
			<WhitelistAllowDescription
				toolCallRequest={
					{ name: "shell", parsed: { cmd: "bun test" } } as never
				}
			/>,
		);
		expect(shell.lastFrame() || "").toContain(
			"commands starting with bun test",
		);

		const lsp = render(
			<WhitelistAllowDescription
				toolCallRequest={{ name: "lsp-hover", parsed: {} } as never}
				whitelistKey="read:/outside/project"
			/>,
		);
		expect(lsp.lastFrame() || "").toContain("file reads in /outside/project");
	});

	it("normalizes whitelist description line breaks before rendering", () => {
		const shell = render(
			<WhitelistAllowDescription
				toolCallRequest={
					{ name: "shell", parsed: { cmd: "printf first\r\nsecond" } } as never
				}
			/>,
		);
		expect(shell.lastFrame() || "").toContain("first");
		expect(shell.lastFrame() || "").toContain("second");
		expect(shell.lastFrame() || "").not.toContain("\r");

		const mcp = render(
			<WhitelistAllowDescription
				toolCallRequest={
					{
						name: "mcp",
						parsed: { server: "server\rone", tool: "tool\r\ntwo" },
					} as never
				}
			/>,
		);
		expect(mcp.lastFrame() || "").toContain("server");
		expect(mcp.lastFrame() || "").toContain("one");
		expect(mcp.lastFrame() || "").toContain("tool");
		expect(mcp.lastFrame() || "").toContain("two");
		expect(mcp.lastFrame() || "").not.toContain("\r");

		const scoped = render(
			<CwdContext.Provider value={"/repo\r\nworkspace"}>
				<WhitelistAllowDescription
					toolCallRequest={{ name: "read", parsed: {} } as never}
				/>
			</CwdContext.Provider>,
		);
		expect(scoped.lastFrame() || "").toContain("/repo");
		expect(scoped.lastFrame() || "").toContain("workspace");
		expect(scoped.lastFrame() || "").not.toContain("\r");
	});

	it("keeps malformed and unknown tool calls hidden", () => {
		const malformed = render(
			<ToolMessageRenderer
				item={{ type: "malformed-tool-request" } as never}
			/>,
		);
		expect(malformed.lastFrame()).toBe("");

		const unknown = render(
			<ToolMessageRenderer
				item={
					{
						type: "tool-call",
						name: "unknown-tool",
						parsed: {},
					} as never
				}
			/>,
		);
		expect(unknown.lastFrame()).toBe("");
	});
});
