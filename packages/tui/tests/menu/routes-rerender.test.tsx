import { describe, expect, it } from "bun:test";
import { render } from "ink-testing-library";
import { errorContext } from "../../src/menu/models/error-context.tsx";
import { Model } from "../../src/menu/models/route-views.tsx";

function baseProps(onSubmit: (model: string) => void) {
	return {
		renderExamples: false,
		done: () => undefined,
		cancel: () => undefined,
		config: null,
		baseUrl: "https://api.synthetic.new/v1",
		auth: undefined,
		back: () => undefined,
		onSubmit,
	};
}

describe("model setup route component rerenders", () => {
	it("model route validates and submits against latest props after rerender", async () => {
		const submitted: string[] = [];
		const errors: string[] = [];
		const firstProps = baseProps((model) => submitted.push(`first:${model}`));
		const secondProps = {
			...baseProps((model) => submitted.push(`second:${model}`)),
			baseUrl: "https://api.openai.com/v1",
		};

		const instance = render(
			<errorContext.Provider
				value={{
					errorMessage: "",
					setErrorMessage: (message) => errors.push(message),
				}}
			>
				<Model {...firstProps} />
			</errorContext.Provider>,
		);

		instance.stdin.write("gpt-5");
		await Bun.sleep(1);
		instance.rerender(
			<errorContext.Provider
				value={{
					errorMessage: "",
					setErrorMessage: (message) => errors.push(message),
				}}
			>
				<Model {...secondProps} />
			</errorContext.Provider>,
		);
		instance.stdin.write("\r");
		await Bun.sleep(1);

		expect(errors).toEqual([]);
		expect(submitted).toEqual(["second:gpt-5"]);
		instance.unmount();
	});
});
