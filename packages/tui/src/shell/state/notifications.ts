import { runNotifyCommand } from "../../runtime/config/notify";
import type { Config } from "../../runtime/config/schemas";
import type { AppStateGet, AppStateSet, UiState } from "./types";

export function createNotificationActions(set: AppStateSet, get: AppStateGet) {
	return {
		setNotifyOnce: (notifyOnce: boolean) => {
			set({ notifyOnce });
		},

		setNotifySession: (sessionAutoNotify: boolean) => {
			set({ sessionAutoNotify });
		},

		notifyReadyForInput: (config: Config) => {
			const { _notifyTimer, sessionAutoNotify, notifyOnce } = get();

			if (notifyOnce) {
				set({ notifyOnce: false });
				// fall through to schedule notification
			} else if (config.notifications?.alwaysNotify || sessionAutoNotify) {
				// fall through to schedule notification
			} else {
				return;
			}

			const notifyTimeout = notifyOnce
				? 0
				: (config.notifications?.notifyTimeoutMs ?? 10_000);

			if (_notifyTimer) clearTimeout(_notifyTimer);
			const timer = setTimeout(async () => {
				const result = await runNotifyCommand(config);
				if (!result.success) {
					set({
						history: [
							...get().history,
							{ type: "notification", content: result.error },
						],
					});
				}
			}, notifyTimeout);

			set({ _notifyTimer: timer });
		},

		cancelNotifyReadyForInput: () => {
			const { _notifyTimer } = get();
			if (_notifyTimer) {
				clearTimeout(_notifyTimer);
				set({ _notifyTimer: null });
			}
		},

		notify: (notif: string) => {
			set({
				history: [
					...get().history,
					{
						type: "notification",
						content: notif,
					},
				],
			});
		},
	} satisfies Pick<
		UiState,
		| "setNotifyOnce"
		| "setNotifySession"
		| "notifyReadyForInput"
		| "cancelNotifyReadyForInput"
		| "notify"
	>;
}
