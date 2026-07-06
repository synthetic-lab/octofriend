import { runNotifyCommand } from "../../internal/configuration/notify.ts";
import type { Config } from "../../internal/configuration/schemas.ts";
import type { AppStateGet, AppStateSet, UiState } from "./types.ts";

export function createNotificationActions(set: AppStateSet, get: AppStateGet) {
	return {
		setNotifyOnce: (notifyOnce: boolean) => {
			set({ notifyOnce });
		},

		setNotifySession: (sessionAutoNotify: boolean) => {
			set({ sessionAutoNotify });
		},

		notifyReadyForInput: (config: Config) => {
			const { sessionAutoNotify, notifyOnce } = get();

			if (notifyOnce) {
				set({ notifyOnce: false });
				// fall through to schedule notification
			} else if (config.notifications?.alwaysNotify || sessionAutoNotify) {
				// fall through to schedule notification
			} else {
				return;
			}

			const notifyTimeout = (() => {
				if (notifyOnce) return 0;
				return config.notifications?.notifyTimeoutMs ?? 10_000;
			})();

			const timer = setTimeout(async () => {
				await runNotifyCommand(config);
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
