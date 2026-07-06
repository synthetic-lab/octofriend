import { describe, expect, it } from "bun:test";
import { Text } from "ink";
import { render } from "ink-testing-library";
import {
	TransportContext,
	useTransport,
} from "../../app/transport_context.tsx";
import { LocalTransport } from "../../internal/transport/local.ts";

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
