import type { AppStateGet, AppStateSet, UiState } from "./types.ts";

export function createMenuActions(set: AppStateSet, get: AppStateGet) {
	return {
		toggleMenu: () => {
			const { modeData } = get();
			if (modeData.mode === "input") {
				set({
					modeData: { mode: "menu" },
					preMenuModeData: modeData,
				});
			} else if (modeData.mode === "menu") {
				const { preMenuModeData } = get();
				set({
					modeData: preMenuModeData ?? { mode: "input", vimMode: "INSERT" },
					preMenuModeData: null,
				});
			}
		},

		closeMenu: () => {
			const { preMenuModeData } = get();
			set({
				modeData: preMenuModeData ?? { mode: "input", vimMode: "INSERT" },
				preMenuModeData: null,
			});
		},

		openMenu: () => {
			const { modeData } = get();
			set({
				modeData: { mode: "menu" },
				preMenuModeData: modeData,
			});
		},

		setVimMode: (vimMode: "INSERT" | "NORMAL") => {
			const { modeData } = get();
			if (modeData.mode === "input") {
				set({
					modeData: { mode: "input", vimMode },
				});
			}
		},

		resetPreMenuVimMode: () => {
			const { preMenuModeData } = get();
			if (preMenuModeData?.mode === "input") {
				set({ preMenuModeData: { ...preMenuModeData, vimMode: "INSERT" } });
			}
		},
	} satisfies Pick<
		UiState,
		| "toggleMenu"
		| "closeMenu"
		| "openMenu"
		| "setVimMode"
		| "resetPreMenuVimMode"
	>;
}
