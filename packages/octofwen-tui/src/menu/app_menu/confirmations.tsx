import { useApp } from "ink";
import { useShallow } from "zustand/react/shallow";
import { useAppStore } from "../../app/state/store.ts";
import { ConfirmDialog } from "../../input/shortcuts.tsx";
import { useMenuState } from "./menu-state.ts";

export function QuitConfirm() {
	const { setMenuMode } = useMenuState(
		useShallow((state) => ({
			setMenuMode: state.setMenuMode,
		})),
	);
	const app = useApp();

	return (
		<ConfirmDialog
			confirmLabel="Yes, quit"
			rejectLabel="Never mind, take me back"
			onConfirm={() => app.exit()}
			onReject={() => setMenuMode("main-menu")}
			rejectFirst={true}
		/>
	);
}

export function ClearConversationConfirm() {
	const { setMenuMode } = useMenuState(
		useShallow((state) => ({
			setMenuMode: state.setMenuMode,
		})),
	);
	const { clearHistory, toggleMenu, notify } = useAppStore(
		useShallow((state) => ({
			clearHistory: state.clearHistory,
			toggleMenu: state.toggleMenu,
			notify: state.notify,
		})),
	);

	return (
		<ConfirmDialog
			confirmLabel="Yes, start new conversation"
			rejectLabel="Never mind, take me back"
			onConfirm={() => {
				clearHistory();
				setMenuMode("main-menu");
				toggleMenu();
				notify("New conversation started");
			}}
			onReject={() => setMenuMode("main-menu")}
		/>
	);
}
