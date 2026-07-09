import { afterEach, describe, expect, it, spyOn } from "bun:test";
import { createTokenHandler } from "../src/prompt-files";

describe("createTokenHandler", () => {
	afterEach(() => {
		(
			process.stdout.write as unknown as { mockRestore?: () => void }
		).mockRestore?.();
		(
			process.stderr.write as unknown as { mockRestore?: () => void }
		).mockRestore?.();
	});

	it("writes reasoning tokens to stderr and content/tool tokens to stdout", () => {
		const stdoutChunks: string[] = [];
		const stderrChunks: string[] = [];
		spyOn(process.stdout, "write").mockImplementation((chunk) => {
			stdoutChunks.push(String(chunk));
			return true;
		});
		spyOn(process.stderr, "write").mockImplementation((chunk) => {
			stderrChunks.push(String(chunk));
			return true;
		});

		const handleToken = createTokenHandler();
		handleToken("thinking", "reasoning");
		handleToken("answer", "content");
		handleToken("tool-json", "tool");
		handleToken(" done", "content");

		expect(stderrChunks).toEqual(["thinking", "\n\n"]);
		expect(stdoutChunks).toEqual(["answer", "tool-json", " done"]);
	});
});
