type TuiModule = typeof import("@octofriend/tui");

const TUI_PACKAGE_NAME = "@octofriend/tui";
const TUI_INCLUDED_SOURCE = new URL("../../tui/src/index.tsx", import.meta.url)
	.href;

let tuiModule: Promise<TuiModule> | undefined;

export function loadTui(): Promise<TuiModule> {
	tuiModule ??= import(TUI_PACKAGE_NAME).catch(async (error: unknown) => {
		if (!isModuleResolutionError(error)) return Promise.reject(error);
		return (await import(TUI_INCLUDED_SOURCE)) as TuiModule;
	});
	return tuiModule;
}

function isModuleResolutionError(error: unknown): boolean {
	return (
		error instanceof Error &&
		(error.name === "ResolveMessage" ||
			error.message.includes("Cannot find package") ||
			error.message.includes("Cannot find module"))
	);
}
