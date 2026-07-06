import { create } from "zustand";

export type MenuMode =
	| "main-menu"
	| "settings-menu"
	| "model-select"
	| "add-model"
	| "diff-apply-toggle"
	| "fix-json-toggle"
	| "set-default-model"
	| "quit-confirm"
	| "remove-model"
	| "clear-confirm"
	| "notifications-menu";

export type MenuState = {
	menuMode: MenuMode;
	setMenuMode: (mode: MenuMode) => void;
};

export const useMenuState = create<MenuState>((set, _) => ({
	menuMode: "main-menu",
	setMenuMode: (menuMode) => {
		set({ menuMode });
	},
}));
