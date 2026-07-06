type TuiModule = typeof import("@octofwen/octofwen-tui");

const TUI_PACKAGE_NAME = "@octofwen/octofwen-tui";
const TUI_INCLUDED_SOURCE = new URL(
	"../../octofwen-tui/src/index.tsx",
	import.meta.url,
).href;

let tuiModule: Promise<TuiModule> | undefined;

export function loadTui(): Promise<TuiModule> {
	tuiModule ??= import(TUI_PACKAGE_NAME).catch(async (error: unknown) => {
		if (!isModuleResolutionError(error)) throw error;
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
