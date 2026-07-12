import hljs from "highlight.js";
import React from "react";
import { parseHighlightedHTML } from "./html-highlight.ts";
import { renderCodeSegments, renderPlainCodeLines } from "./line-highlight.tsx";

function HighlightedCodeComponent({
	code,
	language,
}: {
	code: string;
	language?: string;
}) {
	const model = React.useMemo(
		() => buildHighlightedCodeModel(code, language),
		[code, language],
	);
	return model.rows;
}

export const HighlightedCode = React.memo(HighlightedCodeComponent);

type HighlightedCodeModel = { rows: React.ReactNode[] };

function buildHighlightedCodeModel(
	code: string,
	language: string | undefined,
): HighlightedCodeModel {
	if (!(language && hljs.getLanguage(language))) {
		return { rows: renderPlainCodeLines(code) };
	}
	try {
		const result = hljs.highlight(code, { language });

		return {
			rows: renderCodeSegments(parseHighlightedHTML(result.value)),
		};
	} catch {
		return { rows: renderPlainCodeLines(code) };
	}
}
