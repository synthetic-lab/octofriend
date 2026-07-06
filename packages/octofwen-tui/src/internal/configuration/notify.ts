import { configRunNotify } from "./agentd-config.ts";
import { err, errorToString, ok, type Result } from "../../app/result.ts";
import type { Config } from "./schemas.ts";

export type DesktopNotification = {
	title: string;
	message: string;
};

type ToastedNotifier = {
	notify(
		notification: DesktopNotification,
		callback: (error?: unknown) => void,
	): unknown;
};

export async function runNotifyCommand(
	config: Config,
	notifyDesktop: (
		notification: DesktopNotification,
	) => Promise<void> = notifyWithToastedNotifier,
): Promise<Result<null, string>> {
	const notifyCommand = config.notifications?.notifyCommand;
	try {
		if (notifyCommand != null && notifyCommand.trim() !== "") {
			await configRunNotify(config);
			return ok(null);
		}

		await notifyDesktop({
			title: "Octofwen",
			message: "Octo is waiting for input.",
		});
		return ok(null);
	} catch (error) {
		return err(errorToString(error));
	}
}

async function notifyWithToastedNotifier(
	notification: DesktopNotification,
): Promise<void> {
	const module = await import("toasted-notifier");
	const notifier = (module.default ?? module) as Partial<ToastedNotifier>;
	if (typeof notifier.notify !== "function") {
		return Promise.reject(new Error("toasted-notifier does not expose notify()"));
	}

	await new Promise<void>((resolve, reject) => {
		notifier.notify?.(notification, (error?: unknown) => {
			if (error == null) {
				resolve();
				return;
			}
			reject(error instanceof Error ? error : new Error(String(error)));
		});
	});
}
