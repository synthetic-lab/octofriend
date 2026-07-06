import parseGitDiff from "parse-git-diff";
import { asynctryexpr } from "../packages/octofwen-tui/src/app/result.ts";
import {
	getAllCommits,
	getCommitDiff,
	getFileContentsBeforeAfter,
} from "./git.ts";
import { parseLines } from "./parse.ts";

type DiffEdit = {
	search: string;
	replace: string;
};

export type Diff = {
	edit: DiffEdit;
	file: string;
};

export async function* genDiffs(gitDir: string): AsyncGenerator<Diff> {
	for await (const sha of getAllCommits(gitDir)) {
		const [err, diff] = await asynctryexpr(
			async () => await getCommitDiff(sha, gitDir),
		);
		if (err) continue;
		yield* diffsFromCommitDiff(diff, sha, gitDir);
	}
}

async function* diffsFromCommitDiff(
	diff: string,
	sha: string,
	gitDir: string,
): AsyncGenerator<Diff> {
	const parsed = parseGitDiff(diff);
	if (parsed.type !== "GitDiff") return;
	for (const file of parsed.files) {
		if (file.type === "ChangedFile")
			yield* diffsFromChangedFile(file, sha, gitDir);
	}
}

async function* diffsFromChangedFile(
	file: Extract<
		ReturnType<typeof parseGitDiff>,
		{ type: "GitDiff" }
	>["files"][number],
	sha: string,
	gitDir: string,
): AsyncGenerator<Diff> {
	if (file.type !== "ChangedFile") return;
	const [err, result] = await asynctryexpr(async () => {
		return await getFileContentsBeforeAfter(file.path, sha, gitDir);
	});
	if (err) return;
	const [before, after] = result;
	const beforeLines = parseLines(before);
	const afterLines = parseLines(after);
	for (const chunk of file.chunks) {
		if (chunk.type === "Chunk")
			yield diffFromChunk(chunk, before, beforeLines, afterLines);
	}
}

function diffFromChunk(
	chunk: {
		fromFileRange: { start: number; lines: number };
		toFileRange: { start: number; lines: number };
	},
	before: string,
	beforeLines: string[],
	afterLines: string[],
): Diff {
	return {
		edit: {
			search: getFromRange(beforeLines, chunk.fromFileRange).join("\n"),
			replace: getFromRange(afterLines, chunk.toFileRange).join("\n"),
		},
		file: before,
	};
}

function getFromRange(
	lines: string[],
	range: { start: number; lines: number },
) {
	return lines.slice(range.start - 1, range.start - 1 + range.lines);
}
