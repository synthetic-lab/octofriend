import { describe, expect, it } from "bun:test";
import { Text } from "ink";
import { render } from "ink-testing-library";
import {
	ExitOnDoubleCtrlC,
	useCtrlC,
	useCtrlCPressed,
} from "../../src/input/ctrl-c";

function CtrlCProbe() {
	const pressed = useCtrlCPressed();
	return <Text>{pressed ? "pressed" : "idle"}</Text>;
}

function CtrlCCallbackProbe({ onPress }: { onPress: () => void }) {
	useCtrlC(onPress);
	return <Text>ready</Text>;
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

	it("clears a pending first Ctrl-C when input enters Vim insert mode", async () => {
		let exits = 0;
		const instance = render(
			<ExitOnDoubleCtrlC onExit={() => exits++} resetDelayMs={10_000}>
				<CtrlCProbe />
			</ExitOnDoubleCtrlC>,
		);

		instance.stdin.write("\x03");
		await Bun.sleep(0);
		expect(instance.lastFrame()).toBe("pressed");

		instance.rerender(
			<ExitOnDoubleCtrlC
				isInputInsertMode={true}
				onExit={() => exits++}
				resetDelayMs={10_000}
			>
				<CtrlCProbe />
			</ExitOnDoubleCtrlC>,
		);
		await Bun.sleep(0);

		expect(instance.lastFrame()).toBe("idle");

		instance.stdin.write("\x03");
		await Bun.sleep(0);

		expect(instance.lastFrame()).toBe("idle");
		expect(exits).toBe(0);
	});
	it("uses the latest Ctrl-C callback after rerender without input state churn", async () => {
		const calls: string[] = [];
		const instance = render(
			<CtrlCCallbackProbe onPress={() => calls.push("first")} />,
		);

		instance.rerender(
			<CtrlCCallbackProbe onPress={() => calls.push("second")} />,
		);
		instance.stdin.write("\x03");
		await Bun.sleep(0);

		expect(instance.lastFrame()).toBe("ready");
		expect(calls).toEqual(["second"]);
	});
});
