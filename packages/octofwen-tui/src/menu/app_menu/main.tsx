import { useMemo } from "react";
import { Back, router } from "../model_setup/primitives.tsx";
import { DiffApplyToggle, FixJsonToggle } from "./autofix-toggles.tsx";
import { ClearConversationConfirm, QuitConfirm } from "./confirmations.tsx";
import { MainMenu } from "./main-menu.tsx";
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

export type AppMenuRouteData = {
	mainMenu: Record<string, never>;
	settingsMenu: Record<string, never>;
	modelSelect: Record<string, never>;
	addModel: Record<string, never>;
	diffApplyToggle: Record<string, never>;
	fixJsonToggle: Record<string, never>;
	setDefaultModel: Record<string, never>;
	quitConfirm: Record<string, never>;
	removeModel: Record<string, never>;
	clearConfirm: Record<string, never>;
	notificationsMenu: Record<string, never>;
};

export const appMenuFlow = router<AppMenuRouteData>();
export type { SettingsValues };
export { filterSettingsItems };

export function Menu() {
	const routes = useMemo(
		() =>
			appMenuFlow.route({
				mainMenu: (to) => () => (
					<MainMenu
						onNavigate={{
							settingsMenu: () => to.settingsMenu({}),
							modelSelect: () => to.modelSelect({}),
							addModel: () => to.addModel({}),
							diffApplyToggle: () => to.diffApplyToggle({}),
							fixJsonToggle: () => to.fixJsonToggle({}),
							quitConfirm: () => to.quitConfirm({}),
							clearConfirm: () => to.clearConfirm({}),
							notificationsMenu: () => to.notificationsMenu({}),
						}}
					/>
				),
				settingsMenu: (to) => () => (
					<Back go={() => to.mainMenu({})}>
						<SettingsMenu
							onBack={() => to.mainMenu({})}
							onNavigate={{
								setDefaultModel: () => to.setDefaultModel({}),
								removeModel: () => to.removeModel({}),
								diffApplyToggle: () => to.diffApplyToggle({}),
								fixJsonToggle: () => to.fixJsonToggle({}),
							}}
						/>
					</Back>
				),
				modelSelect: (to) => () => (
					<SwitchModelMenu onBack={() => to.mainMenu({})} />
				),
				addModel: (to) => () => (
					<AddModelMenuFlow
						onComplete={() => to.modelSelect({})}
						onCancel={() => to.mainMenu({})}
					/>
				),
				diffApplyToggle: (to) => () => (
					<Back go={() => to.mainMenu({})}>
						<DiffApplyToggle onBack={() => to.mainMenu({})} />
					</Back>
				),
				fixJsonToggle: (to) => () => (
					<Back go={() => to.mainMenu({})}>
						<FixJsonToggle onBack={() => to.mainMenu({})} />
					</Back>
				),
				setDefaultModel: (to) => () => (
					<Back go={() => to.mainMenu({})}>
						<SetDefaultModelMenu onBack={() => to.mainMenu({})} />
					</Back>
				),
				quitConfirm: (to) => () => (
					<QuitConfirm onBack={() => to.mainMenu({})} />
				),
				removeModel: (to) => () => (
					<Back go={() => to.mainMenu({})}>
						<RemoveModelMenu onBack={() => to.mainMenu({})} />
					</Back>
				),
				clearConfirm: (to) => () => (
					<ClearConversationConfirm onBack={() => to.mainMenu({})} />
				),
				notificationsMenu: (to) => () => (
					<Back go={() => to.mainMenu({})}>
						<NotificationsMenu onBack={() => to.mainMenu({})} />
					</Back>
				),
			}),
		[],
	);

	return <routes.Root route="mainMenu" props={{}} />;
}
