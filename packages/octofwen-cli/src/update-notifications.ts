import path from "node:path";

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
): Promise<string | null> {
	if (!options.read) {
		throw new Error("Update notifications bridge is required");
	}
	const result = await options.read(updateNotificationParams(options));
	return result.updates;
}

export async function markUpdatesSeen(
	options: MarkUpdatesSeenOptions = {},
): Promise<void> {
	if (!options.mark) {
		throw new Error("Update notifications bridge is required");
	}
	await options.mark(updateNotificationParams(options));
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
