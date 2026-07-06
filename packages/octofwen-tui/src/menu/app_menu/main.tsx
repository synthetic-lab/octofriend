import { useShallow } from "zustand/react/shallow";
import { DiffApplyToggle, FixJsonToggle } from "./autofix-toggles.tsx";
import { ClearConversationConfirm, QuitConfirm } from "./confirmations.tsx";
import { MainMenu } from "./main-menu.tsx";
import { type MenuMode, type MenuState, useMenuState } from "./menu-state.ts";
import {
	AddModelMenuFlow,
	RemoveModelMenu,
	SetDefaultModelMenu,
} from "./model-management.tsx";
import { SwitchModelMenu } from "./model-switching.tsx";
import { NotificationsMenu } from "./notifications-menu.tsx";
import {
	filterSettingsItems,
	SettingsMenu,
	type SettingsValues,
} from "./settings-menu.tsx";

export type { MenuMode, MenuState, SettingsValues };
export { filterSettingsItems };

export function Menu() {
	const { menuMode } = useMenuState(
		useShallow((state) => ({
			menuMode: state.menuMode,
		})),
	);

	if (menuMode === "main-menu") return <MainMenu />;
	if (menuMode === "settings-menu") return <SettingsMenu />;
	if (menuMode === "model-select") return <SwitchModelMenu />;
	if (menuMode === "set-default-model") return <SetDefaultModelMenu />;
	if (menuMode === "quit-confirm") return <QuitConfirm />;
	if (menuMode === "clear-confirm") return <ClearConversationConfirm />;
	if (menuMode === "remove-model") return <RemoveModelMenu />;
	if (menuMode === "diff-apply-toggle") return <DiffApplyToggle />;
	if (menuMode === "fix-json-toggle") return <FixJsonToggle />;
	if (menuMode === "notifications-menu") return <NotificationsMenu />;
	const _: "add-model" = menuMode;
	return <AddModelMenuFlow />;
}
