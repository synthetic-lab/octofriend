import { describe, expect, it } from "bun:test";
import { Text } from "ink";
import { render } from "ink-testing-library";
import {
	CwdContext,
	DEFAULT_CWD_CONTEXT_VALUE,
	useCwd,
} from "../../src/shell/workspace-context";

function CwdProbe() {
	return <Text>{useCwd()}</Text>;
}

describe("useCwd", () => {
	it("returns the sentinel default without a provider", () => {
		const { lastFrame } = render(<CwdProbe />);

		expect(lastFrame()).toBe(DEFAULT_CWD_CONTEXT_VALUE);
	});

	it("returns the current working directory from context", () => {
		const { lastFrame } = render(
			<CwdContext.Provider value="/repo">
				<CwdProbe />
			</CwdContext.Provider>,
		);

		expect(lastFrame()).toBe("/repo");
	});
});
