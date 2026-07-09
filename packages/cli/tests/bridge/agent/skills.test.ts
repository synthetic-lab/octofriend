import { describe, expect, it } from "bun:test";
import {
	AGENTD_SKILL_DISCOVER_METHOD,
	AgentdRustBridge,
	type AgentdSkillDiscoverParams,
	type AgentdSkillDiscoverResult,
} from "../../../src/bridge/agent/agent";

type RecordedRequest = { method: string; params?: unknown };

class FakeProcessClient {
	readonly responses: unknown[];
	closed = false;
	readonly requests: RecordedRequest[] = [];
	constructor(responses: unknown[]) {
		this.responses = responses;
	}
	request(method: string, params?: unknown): Promise<unknown> {
		this.requests.push({ method, params });
		return Promise.resolve(this.responses.shift());
	}
	close(): void {
		this.closed = true;
	}
}

describe("AgentdRustBridge skill discovery", () => {
	it("requests agentd skill discovery", async () => {
		const result: AgentdSkillDiscoverResult = {
			skills: [
				{
					name: "project-skill",
					description: "Project skill.",
					instructions: "Use this skill.",
					path: "/repo/.agents/skills/project-skill",
					skillFilePath: "/repo/.agents/skills/project-skill/SKILL.md",
					metadata: {},
				},
			],
		};
		const client = new FakeProcessClient([result]);
		const bridge = new AgentdRustBridge(client);
		const params: AgentdSkillDiscoverParams = {
			cwd: "/repo",
			home: "/home/user",
			configuredSkillPaths: [],
		};

		await expect(bridge.skillDiscover(params)).resolves.toEqual(result);
		expect(client.requests).toEqual([
			{ method: AGENTD_SKILL_DISCOVER_METHOD, params },
		]);
	});
});
