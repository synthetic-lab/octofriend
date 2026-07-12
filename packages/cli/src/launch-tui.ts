type TuiModule = typeof import("@octofriend/tui");

let tuiModule: Promise<TuiModule> | undefined;

export function loadTui(): Promise<TuiModule> {
	tuiModule ??= import("@octofriend/tui");
	return tuiModule;
}
