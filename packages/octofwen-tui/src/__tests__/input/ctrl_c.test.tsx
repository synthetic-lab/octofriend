import { describe, expect, it } from "bun:test";
import { Text } from "ink";
import { render } from "ink-testing-library";
import { ExitOnDoubleCtrlC, useCtrlCPressed } from "../../input/ctrl_c.tsx";

function CtrlCProbe() {
	const pressed = useCtrlCPressed();
	return <Text>{pressed ? "pressed" : "idle"}</Text>;
}

describe("ExitOnDoubleCtrlC", () => {
	it("marks the first Ctrl-C press and exits on the second", async () => {
		let exits = 0;
		const instance = render(
			<ExitOnDoubleCtrlC onExit={() => exits++} resetDelayMs={10_000}>
				<CtrlCProbe />
			</ExitOnDoubleCtrlC>,
		);

		expect(instance.lastFrame()).toBe("idle");

		instance.stdin.write("\x03");
		await Bun.sleep(0);

		expect(instance.lastFrame()).toBe("pressed");
		expect(exits).toBe(0);

		instance.stdin.write("\x03");
		await Bun.sleep(0);

		expect(exits).toBe(1);
	});

	it("ignores the first Ctrl-C while input is in Vim insert mode", async () => {
		let exits = 0;
		const instance = render(
			<ExitOnDoubleCtrlC
				isInputInsertMode={true}
				onExit={() => exits++}
				resetDelayMs={10_000}
			>
				<CtrlCProbe />
			</ExitOnDoubleCtrlC>,
		);

		instance.stdin.write("\x03");
		await Bun.sleep(0);

		expect(instance.lastFrame()).toBe("idle");
		expect(exits).toBe(0);
	});
});
