import { useApp } from "ink";
import { useCallback } from "react";
import { useShallow } from "zustand/react/shallow";
import { useAppStore } from "../../shell/state/store";
import type { UiState } from "../../shell/state/types";
import { ConfirmDialog } from "../../input/shortcuts";

const clearConversationConfirmSelector = (state: UiState) => ({
	clearHistory: state.clearHistory,
	toggleMenu: state.toggleMenu,
	notify: state.notify,
});

export function QuitConfirm({ onBack }: { onBack: () => void }) {
	const app = useApp();
	const handleConfirm = useCallback(() => {
		app.exit();
	}, [app]);

	return (
		<ConfirmDialog
			confirmLabel="Yes, quit"
			rejectLabel="Never mind, take me back"
			onConfirm={handleConfirm}
			onReject={onBack}
			rejectFirst={true}
		/>
	);
}

export function ClearConversationConfirm({ onBack }: { onBack: () => void }) {
	const { clearHistory, toggleMenu, notify } = useAppStore(
		useShallow(clearConversationConfirmSelector),
	);
	const handleConfirm = useCallback(() => {
		clearHistory();
		toggleMenu();
		notify("New conversation started");
	}, [clearHistory, notify, toggleMenu]);

	return (
		<ConfirmDialog
			confirmLabel="Yes, start new conversation"
			rejectLabel="Never mind, take me back"
			onConfirm={handleConfirm}
			onReject={onBack}
		/>
	);
}
