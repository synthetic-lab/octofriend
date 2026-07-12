import { describe, expect, it } from "bun:test";
import type {
	AgentdConversationSessionCreateParams,
	AgentdConversationSessionReplaceParams,
	AgentdRustBridge,
} from "../src/bridge/agent/agent.ts";
import { prepareConversationSession } from "../src/session.ts";

type LoadResult = Awaited<
	ReturnType<AgentdRustBridge["conversationSessionLoad"]>
>;

class FakeSessionBridge {
	readonly creates: AgentdConversationSessionCreateParams[] = [];
	readonly replaces: AgentdConversationSessionReplaceParams[] = [];
	private nextRevisionId = 1;
	loadResult: LoadResult | null = null;

	conversationSessionCreate(
		params: AgentdConversationSessionCreateParams,
	): Promise<Record<string, never>> {
		this.creates.push(params);
		return Promise.resolve({});
	}

	conversationSessionReplace(
		params: AgentdConversationSessionReplaceParams,
	): Promise<{ revisionId: number }> {
		this.replaces.push(params);
		return Promise.resolve({ revisionId: this.nextRevisionId++ });
	}

	conversationSessionLoad(): Promise<LoadResult> {
		if (!this.loadResult)
			return Promise.reject(new Error("missing load result"));
		return Promise.resolve(this.loadResult);
	}
}

function bridge(fake: FakeSessionBridge): AgentdRustBridge {
	return fake as unknown as AgentdRustBridge;
}

const SESSION_ID_PATTERN = /^[a-f0-9-]+$/u;

describe("conversation sessions", () => {
	it("creates a session and serializes queued history snapshots", async () => {
		const fake = new FakeSessionBridge();
		const session = await prepareConversationSession(bridge(fake), {
			cwd: "/workspace/project",
			launch: { kind: "local", unchained: false },
		});

		expect(session.sessionId).toMatch(SESSION_ID_PATTERN);
		expect(fake.creates).toHaveLength(1);
		expect(fake.creates[0]).toMatchObject({
			sessionId: session.sessionId,
			cwd: "/workspace/project",
			launchJson: '{"kind":"local","unchained":false}',
		});

		session.save(session.sessionId, [
			{
				type: "llm-ir",
				ir: {
					role: "user",
					messageId: "user-1",
					content: [{ type: "text", content: "hello" }],
				},
			},
			{ type: "notification", content: "saved" },
		]);
		await session.flush();

		expect(fake.replaces).toHaveLength(1);
		expect(fake.replaces[0]?.parentRevisionId).toBeNull();
		expect(fake.replaces[0]?.records).toEqual([
			{
				kind: "llm-ir",
				payload:
					'{"role":"user","messageId":"user-1","content":[{"type":"text","content":"hello"}]}',
			},
			{ kind: "notification", payload: "saved" },
		]);
	});

	it("preserves concurrent sibling branches and advances each local parent", async () => {
		const fake = new FakeSessionBridge();
		fake.loadResult = {
			metadata: {
				sessionId: "session-branch",
				cwd: "/workspace/project",
				launchJson: '{"kind":"local","unchained":false}',
				createdAt: 100,
				updatedAt: 200,
			},
			revisionId: 7,
			records: [{ id: 0, kind: "notification", payload: "root" }],
		};
		const options = {
			resumeId: "session-branch",
			cwd: "/workspace/project",
			launch: { kind: "local" as const, unchained: false },
		};
		const left = await prepareConversationSession(bridge(fake), options);
		const right = await prepareConversationSession(bridge(fake), options);

		await left.save(left.sessionId, [
			{ type: "notification", content: "left" },
		]);
		await right.save(right.sessionId, [
			{ type: "notification", content: "right" },
		]);
		await left.save(left.sessionId, [
			{ type: "notification", content: "left-next" },
		]);

		expect(fake.replaces.map((replace) => replace.parentRevisionId)).toEqual([
			7, 7, 1,
		]);
	});

	it("loads history and original launch options for resume", async () => {
		const fake = new FakeSessionBridge();
		fake.loadResult = {
			metadata: {
				sessionId: "session-123",
				cwd: "/workspace/project",
				launchJson:
					'{"kind":"local","config":"/tmp/config.json5","unchained":true}',
				createdAt: 100,
				updatedAt: 200,
			},
			revisionId: 7,
			records: [
				{
					id: 1,
					kind: "llm-ir",
					payload:
						'{"role":"assistant","messageId":"assistant-1","content":"hi","usage":{"input":{"cached":0,"uncached":0,"total":0},"output":0}}',
				},
				{ id: 2, kind: "request-failed", payload: null },
			],
		};

		const session = await prepareConversationSession(bridge(fake), {
			resumeId: "session-123",
			cwd: "/workspace/project",
			launch: { kind: "local", unchained: false },
		});

		expect(session.launch).toEqual({
			kind: "local",
			config: "/tmp/config.json5",
			unchained: true,
		});
		expect(session.history).toEqual([
			{
				type: "llm-ir",
				ir: {
					role: "assistant",
					messageId: "assistant-1",
					content: "hi",
					usage: {
						input: { cached: 0, uncached: 0, total: 0 },
						output: 0,
					},
				},
			},
			{ type: "request-failed" },
		]);
		expect(fake.creates).toHaveLength(0);
		session.save(session.sessionId, session.history);
		await session.flush();
		expect(fake.replaces[0]?.parentRevisionId).toBe(7);
	});
});
