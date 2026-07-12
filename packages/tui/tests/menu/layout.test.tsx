import { describe, expect, it } from "bun:test";
import { render } from "ink-testing-library";
import { TerminalSizeProvider } from "../../src/layout/viewport.tsx";
import { SetApiKey } from "../../src/menu/models/api-key.tsx";

describe("SetApiKey layout", () => {
	it("wraps provider text to narrow terminal width", () => {
		const { lastFrame } = render(
			<TerminalSizeProvider size={{ width: 20, height: 10 }}>
				<SetApiKey
					baseUrl="https://api.openai.com/v1"
					provider={{
						name: "123456789012345678901234567890",
						apiKeyUrl: "",
					}}
					onComplete={() => undefined}
					onCancel={() => undefined}
				/>
			</TerminalSizeProvider>,
		);

		const frame = lastFrame() ?? "";
		expect(frame).toContain("for 1234567890123456\n");
		expect(frame).toContain("78901234567890");
	});
});
