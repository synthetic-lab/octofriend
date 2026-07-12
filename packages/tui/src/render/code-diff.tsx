import { diffLines } from "diff";
import { Box } from "ink";
import { useTerminalSize } from "../layout/viewport.tsx";
import { fileExtLanguage, numWidth } from "../shell/text-processing.ts";
import { type DiffPart, SideBySideDiff, StackedDiff } from "./diff-layout.tsx";
import { buildLineCounter } from "./line-segments.tsx";
import { normalizeRenderedLineBreaks, splitRenderedLines } from "./lines.ts";

const STACKED_DIFF_MAX_TERMINAL_WIDTH = 80;
const DIFF_CONTEXT_LINES = 3;

export function DiffRenderer({
	oldText,
	newText,
	fileContents,
	filepath,
}: {
	oldText: string;
	newText: string;
	fileContents: string;
	filepath: string;
}) {
	const terminalSize = useTerminalSize();
	const diffLayout =
		terminalSize.width <= STACKED_DIFF_MAX_TERMINAL_WIDTH
			? "stacked"
			: "side-by-side";

	try {
		const language = fileExtLanguage(filepath);

		const diffWithChanged = focusDiffParts(
			mergeChangedDiffParts(diffLines(oldText, newText)),
		);

		const startLine = getStartLine(fileContents, oldText);
		if (startLine == null) return null;
		const oldLines = splitRenderedLines(oldText);
		const newLines = splitRenderedLines(newText);
		const oldLineCounter = buildLineCounter(startLine);
		const newLineCounter = buildLineCounter(startLine);
		const maxOldLines = startLine + oldLines.length;
		const maxNewLines = startLine + newLines.length;
		const lineNrWidth = Math.max(numWidth(maxOldLines), numWidth(maxNewLines));

		return (
			<Box flexDirection="column">
				<Box flexDirection="column" marginY={1}>
					{diffLayout === "stacked" ? (
						<StackedDiff
							diffParts={diffWithChanged}
							language={language}
							lineNrWidth={lineNrWidth}
							oldLineCounter={oldLineCounter}
							newLineCounter={newLineCounter}
							oldLines={oldLines}
							newLines={newLines}
						/>
					) : (
						<SideBySideDiff
							diffParts={diffWithChanged}
							language={language}
							lineNrWidth={lineNrWidth}
							oldLineCounter={oldLineCounter}
							newLineCounter={newLineCounter}
							oldLines={oldLines}
							newLines={newLines}
						/>
					)}
				</Box>
			</Box>
		);
	} catch (_error) {
		return null;
	}
}

function mergeChangedDiffParts(diff: ReturnType<typeof diffLines>): DiffPart[] {
	const diffWithChanged = new Array<DiffPart>(diff.length);
	let writeIndex = 0;
	let index = 0;
	while (index < diff.length) {
		const curr = diff[index];
		index += 1;
		if (curr === undefined) continue;

		const prev = writeIndex === 0 ? null : diffWithChanged[writeIndex - 1];
		if (prev == null) {
			diffWithChanged[writeIndex] = curr;
			writeIndex += 1;
			continue;
		}
		if (
			!("omitted" in prev || "changed" in prev) &&
			prev.removed &&
			curr.added
		) {
			diffWithChanged[writeIndex - 1] = {
				added: false,
				removed: false,
				changed: true,
				oldValue: prev.value,
				newValue: curr.value,
			};
			continue;
		}
		diffWithChanged[writeIndex] = curr;
		writeIndex += 1;
	}
	if (writeIndex < diffWithChanged.length) diffWithChanged.length = writeIndex;
	return diffWithChanged;
}

function focusUnchangedPart(
	part: Extract<DiffPart, { value: string }>,
	index: number,
	totalParts: number,
	contextLines: number,
): DiffPart[] {
	const normalized = normalizeRenderedLineBreaks(part.value);
	const lines = splitRenderedLines(normalized);
	const trailingBreak = normalized.endsWith("\n");
	if (trailingBreak) lines.pop();
	const prefixCount = index > 0 ? Math.min(contextLines, lines.length) : 0;
	const suffixCount =
		index + 1 < totalParts
			? Math.min(contextLines, lines.length - prefixCount)
			: 0;
	const omittedCount = lines.length - prefixCount - suffixCount;
	if (omittedCount <= 0 || (prefixCount === 0 && suffixCount === 0)) {
		return [part];
	}
	const focused: DiffPart[] = [];
	if (prefixCount > 0) {
		focused.push({
			value: `${lines.slice(0, prefixCount).join("\n")}\n`,
			count: prefixCount,
			added: false,
			removed: false,
		});
	}
	focused.push({ omitted: true, count: omittedCount });
	if (suffixCount > 0) {
		const suffix = lines.slice(lines.length - suffixCount).join("\n");
		focused.push({
			value: trailingBreak ? `${suffix}\n` : suffix,
			count: suffixCount,
			added: false,
			removed: false,
		});
	}
	return focused;
}

export function focusDiffParts(
	diffParts: DiffPart[],
	contextLines = DIFF_CONTEXT_LINES,
): DiffPart[] {
	const focused: DiffPart[] = [];
	for (const [index, part] of diffParts.entries()) {
		if ("omitted" in part) continue;
		if ("changed" in part || part.added || part.removed) {
			focused.push(part);
			continue;
		}
		focused.push(
			...focusUnchangedPart(part, index, diffParts.length, contextLines),
		);
	}
	return focused;
}

function getStartLine(file: string, search: string) {
	const index = file.indexOf(search);
	if (index < 0) return null;
	let line = 1;
	for (let readIndex = 0; readIndex < index; readIndex += 1) {
		const code = file.charCodeAt(readIndex);
		if (code !== 10 && code !== 13) continue;
		line += 1;
		if (code === 13 && file.charCodeAt(readIndex + 1) === 10) readIndex += 1;
	}
	return line;
}
