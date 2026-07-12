import { useCallback, useMemo } from "react";
import { useShallow } from "zustand/react/shallow";
import { useLatestInput, useLatestRef } from "../../input/latest-input.ts";
import {
	type Item,
	KbShortcutPanel,
	type ShortcutArray,
} from "../../input/shortcuts.tsx";
import { useConfig, useSetConfig } from "../../runtime/config/react-context.ts";
import type { Config } from "../../runtime/config/schemas.ts";
import { useAppStore } from "../../shell/state/store.ts";
import type { UiState } from "../../shell/state/types.ts";

const notificationsMenuStateSelector = (state: UiState) => ({
	sessionAutoNotify: state.sessionAutoNotify,
	notifyOnce: state.notifyOnce,
	toggleMenu: state.toggleMenu,
	setNotifyOnce: state.setNotifyOnce,
	setNotifySession: state.setNotifySession,
});

type NotificationValue =
	| "always-notify"
	| "session-notify"
	| "notify-once"
	| "back";

export function buildNotificationShortcutItems({
	alwaysNotify,
	sessionAutoNotify,
	notifyOnce,
}: {
	alwaysNotify: boolean | undefined;
	sessionAutoNotify: boolean;
	notifyOnce: boolean;
}): ShortcutArray<NotificationValue> {
	return [
		{
			type: "key",
			mapping: {
				o: {
					label: notifyOnce
						? "Do not notify the next time Octo needs input"
						: "Notify the next time Octo needs input",
					value: "notify-once",
				},
				s: {
					label: sessionAutoNotify
						? "Stop auto-notifying this session"
						: "Auto-notify for the rest of this session",
					value: "session-notify",
				},
				a: {
					label: alwaysNotify
						? "Stop always auto-notifying"
						: "Always auto-notify",
					value: "always-notify",
				},
				b: {
					label: "Back",
					value: "back",
				},
			},
		},
	];
}

export function NotificationsMenu({ onBack }: { onBack: () => void }) {
	const config = useConfig();
	const setConfig = useSetConfig();
	const {
		sessionAutoNotify,
		notifyOnce,
		toggleMenu,
		setNotifyOnce,
		setNotifySession,
	} = useAppStore(useShallow(notificationsMenuStateSelector));

	const alwaysNotify = config.notifications?.alwaysNotify;
	const configRef = useLatestRef(config);
	const setConfigRef = useLatestRef(setConfig);
	const onBackRef = useLatestRef(onBack);
	const sessionAutoNotifyRef = useLatestRef(sessionAutoNotify);
	const notifyOnceRef = useLatestRef(notifyOnce);
	const toggleMenuRef = useLatestRef(toggleMenu);
	const setNotifyOnceRef = useLatestRef(setNotifyOnce);
	const setNotifySessionRef = useLatestRef(setNotifySession);

	useLatestInput(
		useCallback(
			(_, key) => {
				if (key.escape) onBackRef.current();
			},
			[onBackRef],
		),
	);

	const shortcutItems = useMemo(
		() =>
			buildNotificationShortcutItems({
				alwaysNotify,
				sessionAutoNotify,
				notifyOnce,
			}),
		[alwaysNotify, sessionAutoNotify, notifyOnce],
	);

	const onSelect = useCallback(
		async (item: Item<NotificationValue>) => {
			if (item.value === "always-notify") {
				const currentConfig = configRef.current;
				await setConfigRef.current({
					...currentConfig,
					notifications: {
						...currentConfig.notifications,
						alwaysNotify: !currentConfig.notifications?.alwaysNotify,
					} as Config["notifications"],
				});
			} else if (item.value === "session-notify") {
				setNotifySessionRef.current(!sessionAutoNotifyRef.current);
			} else if (item.value === "notify-once") {
				setNotifyOnceRef.current(!notifyOnceRef.current);
				toggleMenuRef.current();
			} else if (item.value === "back") {
				onBackRef.current();
			}
		},
		[
			configRef,
			setConfigRef,
			sessionAutoNotifyRef,
			notifyOnceRef,
			toggleMenuRef,
			onBackRef,
			setNotifyOnceRef,
			setNotifySessionRef,
		],
	);

	return (
		<KbShortcutPanel
			title="Notifications"
			shortcutItems={shortcutItems}
			onSelect={onSelect}
		/>
	);
}
