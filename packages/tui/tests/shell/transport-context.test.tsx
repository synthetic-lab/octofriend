import { describe, expect, it } from "bun:test";
import { Text } from "ink";
import { render } from "ink-testing-library";
import { LocalTransport } from "../../src/runtime/workspace/local.ts";
import {
	TransportContext,
	useTransport,
} from "../../src/shell/transport-context.tsx";

function TransportProbe() {
	return <Text>{useTransport().cwd}</Text>;
}

describe("terminal transport context", () => {
	it("provides a local transport by default", () => {
		const { lastFrame } = render(<TransportProbe />);

		expect(lastFrame()).toBe(process.cwd());
	});

	it("returns the provided transport from context", () => {
		const transport = new LocalTransport("/workspace");

		const { lastFrame } = render(
			<TransportContext.Provider value={transport}>
				<TransportProbe />
			</TransportContext.Provider>,
		);

		expect(lastFrame()).toBe("/workspace");
	});
});
