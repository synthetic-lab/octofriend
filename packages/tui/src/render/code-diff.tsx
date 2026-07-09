import { diffLines } from "diff";
import { Box } from "ink";
import { fileExtLanguage, numWidth } from "../shell/text-processing";
import { useTerminalSize } from "../layout/viewport";
import {
	type DiffPart,
	SideBySideDiff,
	StackedDiff,
} from "./diff-layout";
import { buildLineCounter } from "./line-segments";
import { splitRenderedLines } from "./lines";

const STACKED_DIFF_MAX_TERMINAL_WIDTH = 80;

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

		const diffWithChanged = mergeChangedDiffParts(diffLines(oldText, newText));

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
		if (prev.removed && curr.added) {
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
