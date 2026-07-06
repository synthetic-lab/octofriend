import { useInput } from "ink";
import { useCallback } from "react";
import { useShallow } from "zustand/react/shallow";
import { useAppStore } from "../../app/state/store.ts";
import {
	type Item,
	KbShortcutPanel,
	type Keymap,
} from "../../input/shortcuts.tsx";
import {
	useConfig,
	useSetConfig,
} from "../../internal/configuration/react-context.ts";
import type { Config } from "../../internal/configuration/schemas.ts";
import { useMenuState } from "./menu-state.ts";

type NotificationValue =
	| "always-notify"
	| "session-notify"
	| "notify-once"
	| "back";

export function NotificationsMenu() {
	const { setMenuMode } = useMenuState(
		useShallow((state) => ({
			setMenuMode: state.setMenuMode,
		})),
	);
	const config = useConfig();
	const setConfig = useSetConfig();
	const {
		sessionAutoNotify,
		notifyOnce,
		toggleMenu,
		setNotifyOnce,
		setNotifySession,
	} = useAppStore(
		useShallow((state) => ({
			sessionAutoNotify: state.sessionAutoNotify,
			notifyOnce: state.notifyOnce,
			toggleMenu: state.toggleMenu,
			setNotifyOnce: state.setNotifyOnce,
			setNotifySession: state.setNotifySession,
		})),
	);

	useInput((_, key) => {
		if (key.escape) setMenuMode("main-menu");
	});

	const alwaysNotify = config.notifications?.alwaysNotify;
	const items: Keymap<NotificationValue> = {
		o: {
			label: notifyOnce
				? "Do not notify the next time Octo needs input"
				: "Notify the next time Octo needs input",
			value: "notify-once" as const,
		},
		s: {
			label: sessionAutoNotify
				? "Stop auto-notifying this session"
				: "Auto-notify for the rest of this session",
			value: "session-notify" as const,
		},
		a: {
			label: alwaysNotify ? "Stop always auto-notifying" : "Always auto-notify",
			value: "always-notify" as const,
		},
		b: {
			label: "Back",
			value: "back" as const,
		},
	};

	const onSelect = useCallback(
		async (item: Item<NotificationValue>) => {
			if (item.value === "always-notify") {
				await setConfig({
					...config,
					notifications: {
						...config.notifications,
						alwaysNotify: !alwaysNotify,
					} as Config["notifications"],
				});
			} else if (item.value === "session-notify") {
				setNotifySession(!sessionAutoNotify);
			} else if (item.value === "notify-once") {
				setNotifyOnce(!notifyOnce);
				setMenuMode("main-menu");
				toggleMenu();
			} else if (item.value === "back") {
				setMenuMode("main-menu");
			}
		},
		[
			config,
			setConfig,
			alwaysNotify,
			sessionAutoNotify,
			notifyOnce,
			toggleMenu,
		],
	);

	return (
		<KbShortcutPanel
			title="Notifications"
			shortcutItems={[{ type: "key" as const, mapping: items }]}
			onSelect={onSelect}
		/>
	);
}
