import path from "node:path";
import { err, ok, type Result } from "./result.ts";

const PACKAGE_ROOT = path.resolve(import.meta.dirname, "../../..");

export const DEFAULT_UPDATES_FILE_PATH = path.join(
	PACKAGE_ROOT,
	"IN-APP-UPDATES.txt",
);

export type UpdateNotificationsParams = {
	updatesPath?: string;
	databasePath?: string;
};

export type UpdateNotificationsReadResult = {
	updates: string | null;
};

export type UpdateNotificationsMarkSeenResult = Record<string, never>;

export type UpdateNotificationsReader = (
	params: UpdateNotificationsParams,
) => Promise<UpdateNotificationsReadResult>;

export type UpdateNotificationsMarker = (
	params: UpdateNotificationsParams,
) => Promise<UpdateNotificationsMarkSeenResult>;

export type ReadUpdatesOptions = UpdateNotificationsParams & {
	read?: UpdateNotificationsReader;
};

export type MarkUpdatesSeenOptions = UpdateNotificationsParams & {
	mark?: UpdateNotificationsMarker;
};

export async function readUpdates(
	options: ReadUpdatesOptions = {},
): Promise<Result<string | null, string>> {
	if (!options.read) {
		return err("Update notifications bridge is required");
	}
	const result = await options.read(updateNotificationParams(options));
	return ok(result.updates);
}

export async function markUpdatesSeen(
	options: MarkUpdatesSeenOptions = {},
): Promise<Result<null, string>> {
	if (!options.mark) {
		return err("Update notifications bridge is required");
	}
	await options.mark(updateNotificationParams(options));
	return ok(null);
}

function updateNotificationParams(
	options: UpdateNotificationsParams,
): UpdateNotificationsParams {
	const updatesPath = options.updatesPath ?? DEFAULT_UPDATES_FILE_PATH;
	if (options.databasePath === undefined) {
		return { updatesPath };
	}
	return { updatesPath, databasePath: options.databasePath };
}
