import { describe, expect, it } from "bun:test";
import { Text } from "ink";
import { render } from "ink-testing-library";
import { TerminalSizeProvider } from "../../src/layout/viewport";
import { errorContext } from "../../src/menu/models/error-context";
import {
	STEP_SUBMIT_ERROR,
	Step,
} from "../../src/menu/models/step";

function renderStep(
	errorMessage: string,
	setErrorMessage: (message: string) => void,
	onSubmit: (value: string) => unknown = () => undefined,
) {
	return render(
		<errorContext.Provider value={{ errorMessage, setErrorMessage }}>
			<Step<string>
				title="Model name"
				prompt="Model:"
				parse={(value) => value}
				validate={() => ({ valid: true })}
				onSubmit={onSubmit}
				children={null}
			/>
		</errorContext.Provider>,
	);
}

function deferred<T>() {
	let resolve: (value: T) => void = () => undefined;
	const promise = new Promise<T>((nextResolve) => {
		resolve = nextResolve;
	});
	return { promise, resolve };
}

async function waitFor(predicate: () => boolean): Promise<void> {
	for (let attempt = 0; attempt < 100; attempt += 1) {
		if (predicate()) return;
		await Bun.sleep(1);
	}
	throw new Error("Timed out waiting for condition");
}

describe("add model step", () => {
	it("wraps body and errors to narrow terminal width", () => {
		const { lastFrame } = render(
			<TerminalSizeProvider size={{ width: 20, height: 10 }}>
				<errorContext.Provider
					value={{
						errorMessage: "abcdefghijabcdefghijabcdefghij",
						setErrorMessage: () => undefined,
					}}
				>
					<Step<string>
						title="Model name"
						prompt="Model:"
						parse={(value) => value}
						validate={() => ({ valid: true })}
						onSubmit={() => undefined}
					>
						<Text wrap="wrap">123456789012345678901234567890</Text>
					</Step>
				</errorContext.Provider>
			</TerminalSizeProvider>,
		);

		const frame = lastFrame() ?? "";
		expect(frame).toContain("12345678901234567890\n");
		expect(frame).toContain("1234567890");
		expect(frame).toContain("abcdefghijabcdefghij\n");
	});
	it("normalizes CR line breaks in title, prompt, and errors", () => {
		const { lastFrame } = render(
			<errorContext.Provider
				value={{
					errorMessage: "bad\r\ninput",
					setErrorMessage: () => undefined,
				}}
			>
				<Step<string>
					title="Model\r\nname"
					prompt="Model:\rvalue"
					parse={(value) => value}
					validate={() => ({ valid: true })}
					onSubmit={() => undefined}
					children={null}
				/>
			</errorContext.Provider>,
		);

		const frame = lastFrame() ?? "";
		expect(frame).toContain("Model");
		expect(frame).toContain("name");
		expect(frame).toContain("value");
		expect(frame).toContain("bad");
		expect(frame).toContain("input");
		expect(frame).not.toContain("\r");
	});

	it("does not clear an already empty error while typing", async () => {
		const errors: string[] = [];
		const instance = renderStep("", (message) => errors.push(message));

		instance.stdin.write("g");
		await Bun.sleep(1);

		expect(errors).toEqual([]);
	});

	it("clears an existing error while typing", async () => {
		const errors: string[] = [];
		const instance = renderStep("old error", (message) => errors.push(message));

		instance.stdin.write("g");
		await Bun.sleep(1);

		expect(errors).toEqual([""]);
	});

	it("renders a generic error when submit throws synchronously", async () => {
		const errors: string[] = [];
		const instance = renderStep(
			"",
			(message) => errors.push(message),
			() => {
				throw new Error("secret submit failure");
			},
		);

		instance.stdin.write("g");
		await Bun.sleep(1);
		instance.stdin.write("\r");
		await Bun.sleep(1);

		expect(errors).toEqual([STEP_SUBMIT_ERROR]);
		expect(instance.lastFrame() ?? "").not.toContain("secret submit failure");
	});

	it("renders a generic error when submit thenables reject", async () => {
		const errors: string[] = [];
		const instance = renderStep(
			"",
			(message) => errors.push(message),
			() => Promise.reject(new Error("secret async failure")),
		);

		instance.stdin.write("g");
		await Bun.sleep(1);
		instance.stdin.write("\r");
		await Bun.sleep(1);

		expect(errors).toEqual([STEP_SUBMIT_ERROR]);
		expect(instance.lastFrame() ?? "").not.toContain("secret async failure");
	});

	it("shows async progress and ignores duplicate submits", async () => {
		const errors: string[] = [];
		const submitted: string[] = [];
		const submit = deferred<void>();
		const instance = renderStep(
			"",
			(message) => errors.push(message),
			(value) => {
				submitted.push(value);
				return submit.promise;
			},
		);

		instance.stdin.write("g");
		await Bun.sleep(1);
		instance.stdin.write("\r");
		await waitFor(() => (instance.lastFrame() ?? "").includes("Working..."));
		instance.stdin.write("\r");
		await Bun.sleep(1);

		expect(submitted).toEqual(["g"]);
		expect(errors).toEqual([]);
		submit.resolve();
		await waitFor(() => !(instance.lastFrame() ?? "").includes("Working..."));
		expect(instance.lastFrame() ?? "").not.toContain("Working...");
	});

	it("uses latest parser, validator, and submitter after rerender", async () => {
		const errors: string[] = [];
		const submitted: string[] = [];
		const instance = render(
			<errorContext.Provider
				value={{
					errorMessage: "",
					setErrorMessage: (message) => errors.push(message),
				}}
			>
				<Step<string>
					title="Model name"
					prompt="Model:"
					parse={(value) => `old:${value}`}
					validate={() => ({ valid: true })}
					onSubmit={(value) => submitted.push(`old-submit:${value}`)}
					children={null}
				/>
			</errorContext.Provider>,
		);

		instance.stdin.write("g");
		await Bun.sleep(1);
		instance.rerender(
			<errorContext.Provider
				value={{
					errorMessage: "",
					setErrorMessage: (message) => errors.push(message),
				}}
			>
				<Step<string>
					title="Model name"
					prompt="Model:"
					parse={(value) => `new:${value}`}
					validate={(value) =>
						value === "g"
							? { valid: true }
							: { valid: false, error: "wrong value" }
					}
					onSubmit={(value) => submitted.push(`new-submit:${value}`)}
					children={null}
				/>
			</errorContext.Provider>,
		);
		instance.stdin.write("\r");
		await Bun.sleep(1);

		expect(errors).toEqual([]);
		expect(submitted).toEqual(["new-submit:new:g"]);
	});

	it("updates default text after rerender until the user edits", async () => {
		const errors: string[] = [];
		const submitted: string[] = [];
		const renderDefaultStep = (defaultValue: string) => (
			<errorContext.Provider
				value={{
					errorMessage: "",
					setErrorMessage: (message) => errors.push(message),
				}}
			>
				<Step<string>
					title="Nickname"
					prompt="Nickname:"
					defaultValue={defaultValue}
					parse={(value) => value}
					validate={() => ({ valid: true })}
					onSubmit={(value) => submitted.push(value)}
					children={null}
				/>
			</errorContext.Provider>
		);
		const instance = render(renderDefaultStep("old model"));

		await waitFor(() => (instance.lastFrame() ?? "").includes("old model"));
		instance.rerender(renderDefaultStep("new model"));
		await waitFor(() => (instance.lastFrame() ?? "").includes("new model"));
		instance.stdin.write(" custom");
		await waitFor(() =>
			(instance.lastFrame() ?? "").includes("new model custom"),
		);
		instance.rerender(renderDefaultStep("third model"));
		await Bun.sleep(1);
		instance.stdin.write("\r");
		await Bun.sleep(1);

		expect(instance.lastFrame() ?? "").toContain("new model custom");
		expect(instance.lastFrame() ?? "").not.toContain("third model");
		expect(submitted).toEqual(["new model custom"]);
	});

	it("uses latest error setter after rerender", async () => {
		const calls: string[] = [];
		const instance = render(
			<errorContext.Provider
				value={{
					errorMessage: "old error",
					setErrorMessage: () => calls.push("first:clear"),
				}}
			>
				<Step<string>
					title="Model name"
					prompt="Model:"
					parse={(value) => value}
					validate={() => ({ valid: true })}
					onSubmit={() => undefined}
					children={null}
				/>
			</errorContext.Provider>,
		);

		instance.rerender(
			<errorContext.Provider
				value={{
					errorMessage: "old error",
					setErrorMessage: () => calls.push("second:clear"),
				}}
			>
				<Step<string>
					title="Model name"
					prompt="Model:"
					parse={(value) => value}
					validate={() => ({ valid: true })}
					onSubmit={() => undefined}
					children={null}
				/>
			</errorContext.Provider>,
		);
		instance.stdin.write("g");
		await Bun.sleep(1);

		expect(calls).toEqual(["second:clear"]);
	});
});
