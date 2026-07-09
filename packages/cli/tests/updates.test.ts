import { expect, test } from "bun:test";
import path from "node:path";
import type { Result } from "../src/result";
import {
	DEFAULT_UPDATES_FILE_PATH,
	markUpdatesSeen,
	readUpdates,
	type UpdateNotificationsParams,
} from "../src/updates";

function bridgeBackedUpdateStore(initialUpdate: string) {
	let currentUpdate = initialUpdate;
	let mostRecentSeen: string | null = null;
	const reads: UpdateNotificationsParams[] = [];
	const marks: UpdateNotificationsParams[] = [];
	return {
		reads,
		marks,
		setCurrentUpdate(update: string) {
			currentUpdate = update;
		},
		read: (params: UpdateNotificationsParams) => {
			reads.push(params);
			return Promise.resolve({
				updates: mostRecentSeen === currentUpdate ? null : currentUpdate,
			});
		},
		mark: (params: UpdateNotificationsParams) => {
			marks.push(params);
			mostRecentSeen = currentUpdate;
			return Promise.resolve({});
		},
	};
}

const fixture = {
	updatesPath: "/tmp/IN-APP-UPDATES.txt",
	databasePath: "/tmp/sqlite.db",
};

function expectOk<T, E>(result: Result<T, E>): T {
	if (result.success) return result.data;
	throw new Error(String(result.error));
}

test("readUpdates returns the current update text before it has been marked seen", async () => {
	const store = bridgeBackedUpdateStore("New Octo update\n");

	expect(expectOk(await readUpdates({ ...fixture, read: store.read }))).toBe(
		"New Octo update\n",
	);
	expect(store.reads).toEqual([fixture]);
});

test("readUpdates returns null when the current update text is the most recent seen update", async () => {
	const store = bridgeBackedUpdateStore("Already seen\n");

	expectOk(await markUpdatesSeen({ ...fixture, mark: store.mark }));

	expect(
		expectOk(await readUpdates({ ...fixture, read: store.read })),
	).toBeNull();
});

test("readUpdates returns changed update text after an older update was marked seen", async () => {
	const store = bridgeBackedUpdateStore("First update\n");
	expectOk(await markUpdatesSeen({ ...fixture, mark: store.mark }));
	store.setCurrentUpdate("Second update\n");

	expect(expectOk(await readUpdates({ ...fixture, read: store.read }))).toBe(
		"Second update\n",
	);
});

test("markUpdatesSeen is idempotent for the same update text", async () => {
	const store = bridgeBackedUpdateStore("Duplicate update\n");

	expectOk(await markUpdatesSeen({ ...fixture, mark: store.mark }));
	expectOk(await markUpdatesSeen({ ...fixture, mark: store.mark }));

	expect(
		expectOk(await readUpdates({ ...fixture, read: store.read })),
	).toBeNull();
	expect(store.marks).toEqual([fixture, fixture]);
});

test("default update notification params omit database path so storage owns persisted location", async () => {
	const store = bridgeBackedUpdateStore("New Octo update\n");

	expectOk(await readUpdates({ read: store.read }));
	expectOk(await markUpdatesSeen({ mark: store.mark }));

	const expectedParams = { updatesPath: DEFAULT_UPDATES_FILE_PATH };
	expect(DEFAULT_UPDATES_FILE_PATH).toBe(
		path.resolve(import.meta.dir, "../../../IN-APP-UPDATES.txt"),
	);
	expect(store.reads).toEqual([expectedParams]);
	expect(store.marks).toEqual([expectedParams]);
});

test("missing update notification bridges return Result errors", async () => {
	const readResult = await readUpdates();
	const markResult = await markUpdatesSeen();

	expect(readResult.success).toBe(false);
	if (!readResult.success) {
		expect(readResult.error).toBe("Update notifications bridge is required");
	}
	expect(markResult.success).toBe(false);
	if (!markResult.success) {
		expect(markResult.error).toBe("Update notifications bridge is required");
	}
});
