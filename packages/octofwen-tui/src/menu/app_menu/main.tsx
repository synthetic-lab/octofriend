import { useCallback, useMemo } from "react";
import { Back, router, type ToRoute } from "../model_setup/setup-router.tsx";
import { DiffApplyToggle, FixJsonToggle } from "./autofix-toggles.tsx";
import { ClearConversationConfirm, QuitConfirm } from "./confirmations.tsx";
import {
	buildMainMenuShortcutItems,
	handleMainMenuSelection,
	MainMenu,
	mainMenuShortcutState,
} from "./main-menu.tsx";
import {
	AddModelMenuFlow,
	RemoveModelMenu,
	SetDefaultModelMenu,
} from "./model-management.tsx";
import { SwitchModelMenu } from "./model-switching.tsx";
import {
	buildNotificationShortcutItems,
	NotificationsMenu,
} from "./notifications-menu.tsx";
import {
	buildSettingsMenuShortcutItems,
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
const EMPTY_MENU_ROUTE_PROPS: Record<string, never> = {};

export type { SettingsValues };
export {
	buildMainMenuShortcutItems,
	buildNotificationShortcutItems,
	buildSettingsMenuShortcutItems,
	filterSettingsItems,
	handleMainMenuSelection,
	mainMenuShortcutState,
};

function AddModelRoute({ to }: { to: ToRoute<AppMenuRouteData> }) {
	const handleComplete = useCallback(
		() => to.modelSelect(EMPTY_MENU_ROUTE_PROPS),
		[to],
	);
	const handleCancel = useCallback(
		() => to.mainMenu(EMPTY_MENU_ROUTE_PROPS),
		[to],
	);
	return (
		<AddModelMenuFlow onComplete={handleComplete} onCancel={handleCancel} />
	);
}

function ModelSelectRoute({ to }: { to: ToRoute<AppMenuRouteData> }) {
	const handleBack = useCallback(
		() => to.mainMenu(EMPTY_MENU_ROUTE_PROPS),
		[to],
	);
	return <SwitchModelMenu onBack={handleBack} />;
}

function SettingsRoute({ to }: { to: ToRoute<AppMenuRouteData> }) {
	const handleBack = useCallback(
		() => to.mainMenu(EMPTY_MENU_ROUTE_PROPS),
		[to],
	);
	const onNavigate = useMemo(
		() => ({
			setDefaultModel: () => to.setDefaultModel(EMPTY_MENU_ROUTE_PROPS),
			removeModel: () => to.removeModel(EMPTY_MENU_ROUTE_PROPS),
			diffApplyToggle: () => to.diffApplyToggle(EMPTY_MENU_ROUTE_PROPS),
			fixJsonToggle: () => to.fixJsonToggle(EMPTY_MENU_ROUTE_PROPS),
		}),
		[to],
	);

	return (
		<Back go={handleBack}>
			<SettingsMenu onBack={handleBack} onNavigate={onNavigate} />
		</Back>
	);
}

function DiffApplyToggleRoute({ to }: { to: ToRoute<AppMenuRouteData> }) {
	const handleBack = useCallback(
		() => to.mainMenu(EMPTY_MENU_ROUTE_PROPS),
		[to],
	);
	return (
		<Back go={handleBack}>
			<DiffApplyToggle onBack={handleBack} />
		</Back>
	);
}

function FixJsonToggleRoute({ to }: { to: ToRoute<AppMenuRouteData> }) {
	const handleBack = useCallback(
		() => to.mainMenu(EMPTY_MENU_ROUTE_PROPS),
		[to],
	);
	return (
		<Back go={handleBack}>
			<FixJsonToggle onBack={handleBack} />
		</Back>
	);
}

function SetDefaultModelRoute({ to }: { to: ToRoute<AppMenuRouteData> }) {
	const handleBack = useCallback(
		() => to.mainMenu(EMPTY_MENU_ROUTE_PROPS),
		[to],
	);
	return (
		<Back go={handleBack}>
			<SetDefaultModelMenu onBack={handleBack} />
		</Back>
	);
}

function RemoveModelRoute({ to }: { to: ToRoute<AppMenuRouteData> }) {
	const handleBack = useCallback(
		() => to.mainMenu(EMPTY_MENU_ROUTE_PROPS),
		[to],
	);
	return (
		<Back go={handleBack}>
			<RemoveModelMenu onBack={handleBack} />
		</Back>
	);
}

function MainMenuRoute({ to }: { to: ToRoute<AppMenuRouteData> }) {
	const onNavigate = useMemo(
		() => ({
			settingsMenu: () => to.settingsMenu(EMPTY_MENU_ROUTE_PROPS),
			modelSelect: () => to.modelSelect(EMPTY_MENU_ROUTE_PROPS),
			addModel: () => to.addModel(EMPTY_MENU_ROUTE_PROPS),
			diffApplyToggle: () => to.diffApplyToggle(EMPTY_MENU_ROUTE_PROPS),
			fixJsonToggle: () => to.fixJsonToggle(EMPTY_MENU_ROUTE_PROPS),
			quitConfirm: () => to.quitConfirm(EMPTY_MENU_ROUTE_PROPS),
			clearConfirm: () => to.clearConfirm(EMPTY_MENU_ROUTE_PROPS),
			notificationsMenu: () => to.notificationsMenu(EMPTY_MENU_ROUTE_PROPS),
		}),
		[to],
	);
	return <MainMenu onNavigate={onNavigate} />;
}

function QuitConfirmRoute({ to }: { to: ToRoute<AppMenuRouteData> }) {
	const handleBack = useCallback(
		() => to.mainMenu(EMPTY_MENU_ROUTE_PROPS),
		[to],
	);
	return <QuitConfirm onBack={handleBack} />;
}

function ClearConfirmRoute({ to }: { to: ToRoute<AppMenuRouteData> }) {
	const handleBack = useCallback(
		() => to.mainMenu(EMPTY_MENU_ROUTE_PROPS),
		[to],
	);
	return <ClearConversationConfirm onBack={handleBack} />;
}

function NotificationsRoute({ to }: { to: ToRoute<AppMenuRouteData> }) {
	const handleBack = useCallback(
		() => to.mainMenu(EMPTY_MENU_ROUTE_PROPS),
		[to],
	);
	return (
		<Back go={handleBack}>
			<NotificationsMenu onBack={handleBack} />
		</Back>
	);
}

export function Menu() {
	const routes = useMemo(
		() =>
			appMenuFlow.route({
				mainMenu: (to) => () => <MainMenuRoute to={to} />,
				settingsMenu: (to) => () => <SettingsRoute to={to} />,
				modelSelect: (to) => () => <ModelSelectRoute to={to} />,
				addModel: (to) => () => <AddModelRoute to={to} />,
				diffApplyToggle: (to) => () => <DiffApplyToggleRoute to={to} />,
				fixJsonToggle: (to) => () => <FixJsonToggleRoute to={to} />,
				setDefaultModel: (to) => () => <SetDefaultModelRoute to={to} />,
				quitConfirm: (to) => () => <QuitConfirmRoute to={to} />,
				removeModel: (to) => () => <RemoveModelRoute to={to} />,
				clearConfirm: (to) => () => <ClearConfirmRoute to={to} />,
				notificationsMenu: (to) => () => <NotificationsRoute to={to} />,
			}),
		[],
	);

	return <routes.Root route="mainMenu" props={EMPTY_MENU_ROUTE_PROPS} />;
}
