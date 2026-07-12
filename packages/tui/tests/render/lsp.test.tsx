import { describe, expect, it } from "bun:test";
import { render } from "ink-testing-library";
import { getLspActionName, LspToolRenderer } from "../../src/render/lsp.tsx";

describe("getLspActionName", () => {
	it("maps known LSP tool names and falls back to query", () => {
		expect(getLspActionName("lsp-definition")).toBe("definition");
		expect(getLspActionName("lsp-document-symbol")).toBe("document symbol");
		expect(getLspActionName("lsp-custom")).toBe("query");
	});
});

describe("LspToolRenderer", () => {
	it("renders file-only LSP requests", () => {
		const { lastFrame } = render(
			<LspToolRenderer
				item={{
					name: "lsp-diagnostics",
					arguments: { filePath: "source/app.tsx" },
				}}
			/>,
		);

		expect(lastFrame()).toContain(
			"Octo wants to run LSP diagnostics on source/app.tsx",
		);
	});

	it("renders positioned LSP requests", () => {
		const { lastFrame } = render(
			<LspToolRenderer
				item={{
					name: "lsp-definition",
					arguments: { filePath: "source/app.tsx", line: 10, character: 4 },
				}}
			/>,
		);

		expect(lastFrame()).toContain(
			"Octo wants to run LSP definition at source/app.tsx:10:4",
		);
	});
});
