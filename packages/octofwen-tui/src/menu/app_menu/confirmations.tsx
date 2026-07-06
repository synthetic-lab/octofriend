import { useApp } from "ink";
import { useShallow } from "zustand/react/shallow";
import { useAppStore } from "../../app/state/store.ts";
import { ConfirmDialog } from "../../input/shortcuts.tsx";

export function QuitConfirm({ onBack }: { onBack: () => void }) {
	const app = useApp();

	return (
		<ConfirmDialog
			confirmLabel="Yes, quit"
			rejectLabel="Never mind, take me back"
			onConfirm={() => app.exit()}
			onReject={onBack}
			rejectFirst={true}
		/>
	);
}

export function ClearConversationConfirm({ onBack }: { onBack: () => void }) {
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
				toggleMenu();
				notify("New conversation started");
			}}
			onReject={onBack}
		/>
	);
}
