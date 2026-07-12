import { describe, expect, it } from "bun:test";

async function waitFor(predicate: () => boolean): Promise<void> {
	for (let attempt = 0; attempt < 200; attempt += 1) {
		if (predicate()) return;
		await Bun.sleep(1);
	}
	throw new Error("Timed out waiting for condition");
}

describe("terminal setup router", () => {
	it("uses the latest back callback after rerender", async () => {
		const React = await import("react");
		const { Text } = await import("ink");
		const { render } = await import("ink-testing-library");
		const { Back } = await import("../../src/menu/models/router.tsx");
		const calls: string[] = [];
		const instance = render(
			React.createElement(Back, {
				go: () => {
					calls.push("old");
				},
				children: React.createElement(Text, null, "ready"),
			}),
		);

		instance.rerender(
			React.createElement(Back, {
				go: () => {
					calls.push("new");
				},
				children: React.createElement(Text, null, "ready"),
			}),
		);
		instance.stdin.write("\u001B");
		await waitFor(() => calls.length === 1);

		expect(calls).toEqual(["new"]);
	});

	it("updates the active initial route when root props change", async () => {
		const React = await import("react");
		const { Text } = await import("ink");
		const { render } = await import("ink-testing-library");
		const { router } = await import("../../src/menu/models/router.tsx");
		type Routes = {
			first: { value: string };
			second: { count: number };
		};
		const routes = router<Routes>().route({
			first: () => (props) => React.createElement(Text, null, props.value),
			second: () => (props) => React.createElement(Text, null, props.count),
		});

		const firstProps = { value: "first model" };
		const secondProps = { count: 2 };
		const instance = render(
			React.createElement(routes.Root, {
				route: "first",
				props: firstProps,
			}),
		);
		await waitFor(() => (instance.lastFrame() ?? "").includes("first model"));

		instance.rerender(
			React.createElement(routes.Root, {
				route: "second",
				props: secondProps,
			}),
		);

		await waitFor(() => (instance.lastFrame() ?? "").includes("2"));
		expect(instance.lastFrame()).toContain("2");
	});

	it("keeps the active route when recreated initial props are shallow-equal", async () => {
		const React = await import("react");
		const { Text } = await import("ink");
		const { render } = await import("ink-testing-library");
		const { router } = await import("../../src/menu/models/router.tsx");
		type Routes = {
			first: { value: string; jump: boolean };
			second: { count: number };
		};
		const routes = router<Routes>().route({
			first: (to) => (props) => {
				React.useEffect(() => {
					if (props.jump) to.second({ count: 2 });
				}, [props.jump, to]);
				return React.createElement(Text, null, props.value);
			},
			second: () => (props) => React.createElement(Text, null, props.count),
		});

		const instance = render(
			React.createElement(routes.Root, {
				route: "first",
				props: { value: "first model", jump: true },
			}),
		);
		await waitFor(() => (instance.lastFrame() ?? "").includes("2"));

		instance.rerender(
			React.createElement(routes.Root, {
				route: "first",
				props: { value: "first model", jump: true },
			}),
		);

		await Bun.sleep(1);
		expect(instance.lastFrame()).toContain("2");
	});

	it("ignores duplicate route transitions with shallow-equal props", async () => {
		const React = await import("react");
		const { Text } = await import("ink");
		const { render } = await import("ink-testing-library");
		const { router } = await import("../../src/menu/models/router.tsx");
		type Routes = {
			first: { value: string };
		};
		let renders = 0;
		const routes = router<Routes>().route({
			first: (to) => (props) => {
				renders += 1;
				React.useEffect(() => {
					to.first({ value: props.value });
				}, [props.value, to]);
				return React.createElement(Text, null, props.value);
			},
		});

		render(
			React.createElement(routes.Root, {
				route: "first",
				props: { value: "stable" },
			}),
		);

		await Bun.sleep(1);
		expect(renders).toBe(1);
	});
});
