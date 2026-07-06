#!/usr/bin/env bun

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const SOURCE_ROOTS = ["crates", "packages"];
const IGNORED_DIRS = new Set(["dist", "node_modules", "target"]);
const MAX_FIELDS = 10;
const MAX_PARAMETERS = 5;
const DUPLICATE_MIN_TOKENS = 3;
const CLI_DUPLICATE_MIN_TOKENS = 30;
const COMPLEX_TYPE_PATTERN =
	/(?:[A-Za-z_][\w:.$]*\s*(?:<[^;{}()]+>|\[[^\]]+\])|(?:Vec|Option|Result|HashMap|BTreeMap|Array|Promise|Record|ReadonlyArray|Map|Set)\s*<[^;{}()]+>)/u;
const TYPE_NORMALIZE_PATTERN = /\s+/gu;
const IDENTIFIER_PATTERN = /[A-Za-z_$][\w$]*/gu;
const STRING_PATTERN = /"(?:\\.|[^"])*"|'(?:\\.|[^'])*'|`(?:\\.|[^`])*`/gu;
const NUMBER_PATTERN = /\b\d+(?:\.\d+)?\b/gu;
const RUST_FUNCTION_PATTERN =
	/(?:^|\n)\s*(?:pub(?:\([^)]*\))?\s+)?(?:async\s+)?fn\s+([A-Za-z_][A-Za-z0-9_]*)\s*\(/gu;
const TYPESCRIPT_FUNCTION_PATTERN =
	/(?:^|\n)\s*(?:export\s+)?(?:async\s+)?function\s+([A-Za-z_$][\w$]*)\s*\(/gu;
const TYPESCRIPT_ARROW_PATTERN =
	/(?:^|\n)\s*(?:export\s+)?const\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?\([^)]*\)\s*=>/gu;
const RUST_STRUCT_PATTERN =
	/(?:^|\n)\s*(?:pub(?:\([^)]*\))?\s+)?struct\s+([A-Za-z_][A-Za-z0-9_]*)\s*\{/gu;
const TYPESCRIPT_INTERFACE_PATTERN =
	/(?:^|\n)\s*(?:export\s+)?interface\s+([A-Za-z_$][\w$]*)[^{}]*\{/gu;
const TYPESCRIPT_TYPE_OBJECT_PATTERN =
	/(?:^|\n)\s*(?:export\s+)?type\s+([A-Za-z_$][\w$]*)\s*=\s*\{/gu;
const RUST_CONCRETE_TYPE_PATTERN =
	/(?:^|\n)\s*(?:pub(?:\([^)]*\))?\s+)?(?:struct|enum)\s+([A-Za-z_][A-Za-z0-9_]*)(?:\s*<[^>{}]+>)?\s*[;{]/gu;
const TYPESCRIPT_CONCRETE_TYPE_PATTERN =
	/(?:^|\n)\s*(?:export\s+)?(?:interface|class)\s+([A-Za-z_$][\w$]*)/gu;
const TOKEN_SPLIT_PATTERN = /[^A-Z]+/u;
const RUST_PARAMETER_PATTERN =
	/^(?:mut\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*:\s*(.+)$/u;
const TYPESCRIPT_TYPED_PARAMETER_PATTERN =
	/^(?:\.\.\.)?([A-Za-z_$][\w$]*)\??\s*:\s*(.+)$/u;
const TYPESCRIPT_DEFAULT_PARAMETER_PATTERN =
	/^(?:\.\.\.)?([A-Za-z_$][\w$]*)\??\s*(?:=.*)?$/u;
const RUST_RETURN_TYPE_PATTERN = /->\s*([^{}]+)$/u;
const TYPESCRIPT_RETURN_TYPE_PATTERN = /^\s*:\s*([^={]+)$/u;
const RUST_FIELD_PATTERN =
	/^(?:pub(?:\([^)]*\))?\s+)?[A-Za-z_][A-Za-z0-9_]*\s*:/u;
const TYPESCRIPT_FIELD_PATTERN = /^(?:readonly\s+)?[A-Za-z_$][\w$]*\??\s*:/u;
const COMMON_COMPLEX_TYPE_PATTERN =
	/^(?:Option<(?:String|&str|usize|bool)>|Vec<(?:String|&str)>|Array<string>|Promise<void>)$/u;
const SIMPLE_OPTION_TYPE_PATTERN =
	/^Option<&?(?:lifetime |'static )?(?:str|Self|[A-Za-z_][\w:.$]*(?:<lifetime>)?)>$/u;
const SIMPLE_RESULT_TYPE_PATTERN =
	/^Result<[A-Za-z_][\w:.$]*(?:<lifetime>)?,[A-Za-z_][\w:.$]*(?:<lifetime>)?>$/u;
const TYPE_ALIAS_PATTERN =
	/(?:^|\n)\s*(?:(?:export|pub(?:\([^)]*\))?)\s+)?type\s+([A-Za-z_][\w]*)\s*(?:<[^=]+>)?\s*=/gu;
const TYPE_REFERENCE_PREFIX_PATTERN = /^&(?:mut\s+)?/u;
const TYPE_GENERIC_SUFFIX_PATTERN = /<.*$/u;
const TYPE_ARRAY_SUFFIX_PATTERN = /\[.*$/u;
const LEADING_UNDERSCORES_PATTERN = /^_+/u;
const TRAILING_SEMICOLON_PATTERN = /;$/u;
const RUST_PASS_THROUGH_PATTERN =
	/^(?:return\s+)?([A-Za-z_][\w:]*)\s*\([^{};]*\)\??$/u;
const TYPESCRIPT_PASS_THROUGH_PATTERN =
	/^return\s+([A-Za-z_$][\w$.]*)\s*\([^{};]*\)$/u;
const UPPERCASE_START_PATTERN = /^[A-Z]/u;

// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: comment stripping is a small lexer.
function stripComments(source) {
	let output = "";
	let quote = "";
	let blockComment = false;
	let lineComment = false;

	for (let index = 0; index < source.length; index += 1) {
		const char = source[index];
		const next = source[index + 1];
		const previous = source[index - 1];

		if (lineComment) {
			if (char === "\n") {
				lineComment = false;
				output += char;
			}
			continue;
		}

		if (blockComment) {
			if (char === "\n") {
				output += char;
			}
			if (char === "*" && next === "/") {
				blockComment = false;
				index += 1;
			}
			continue;
		}

		if (quote) {
			output += char;
			if (char === quote && previous !== "\\") {
				quote = "";
			}
			continue;
		}

		if (char === "/" && next === "/") {
			lineComment = true;
			index += 1;
			continue;
		}

		if (char === "/" && next === "*") {
			blockComment = true;
			index += 1;
			continue;
		}

		if (isQuote(char)) {
			quote = char;
		}
		output += char;
	}

	return output;
}

function lineNumber(source, index) {
	return source.slice(0, index).split("\n").length;
}

function hasCfgTestAttribute(source, index) {
	const prefix = source.slice(0, index);
	const lines = prefix.split("\n");
	for (let lineIndex = lines.length - 1; lineIndex >= 0; lineIndex -= 1) {
		const line = lines[lineIndex].trim();
		if (!line) {
			continue;
		}
		if (line.startsWith("#[")) {
			if (line.includes("cfg(test)")) {
				return true;
			}
			continue;
		}
		return false;
	}
	return false;
}

function isQuote(char, singleQuote = true) {
	return char === '"' || (singleQuote && char === "'") || char === "`";
}

function rustCharLiteralEnd(source, startIndex) {
	if (source[startIndex] !== "'") {
		return -1;
	}
	if (source[startIndex + 1] === "\\") {
		return source[startIndex + 3] === "'" ? startIndex + 3 : -1;
	}
	return source[startIndex + 2] === "'" ? startIndex + 2 : -1;
}

// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: delimiter matching is a small state machine.
function matchingIndex(source, openIndex, openChar, closeChar, options = {}) {
	let depth = 0;
	let quote = "";

	for (let index = openIndex; index < source.length; index += 1) {
		const char = source[index];
		const previous = source[index - 1];

		if (quote) {
			if (char === quote && previous !== "\\") {
				quote = "";
			}
			continue;
		}

		if (options.singleQuote === false && char === "'") {
			const charLiteralEnd = rustCharLiteralEnd(source, index);
			if (charLiteralEnd > index) {
				index = charLiteralEnd;
				continue;
			}
		}

		if (isQuote(char, options.singleQuote !== false)) {
			quote = char;
			continue;
		}

		if (char === openChar) {
			depth += 1;
			continue;
		}

		if (char === closeChar) {
			depth -= 1;
			if (depth === 0) {
				return index;
			}
		}
	}

	return -1;
}

// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: top-level splitting tracks nested syntax state.
function splitTopLevel(source, separator, options = {}) {
	const parts = [];
	let start = 0;
	let angleDepth = 0;
	let braceDepth = 0;
	let bracketDepth = 0;
	let parenDepth = 0;
	let quote = "";

	for (let index = 0; index < source.length; index += 1) {
		const char = source[index];
		const previous = source[index - 1];

		if (quote) {
			if (char === quote && previous !== "\\") {
				quote = "";
			}
			continue;
		}

		if (options.singleQuote === false && char === "'") {
			const charLiteralEnd = rustCharLiteralEnd(source, index);
			if (charLiteralEnd > index) {
				index = charLiteralEnd;
				continue;
			}
		}

		if (isQuote(char, options.singleQuote !== false)) {
			quote = char;
			continue;
		}

		if (char === "<") angleDepth += 1;
		if (char === ">" && angleDepth > 0) angleDepth -= 1;
		if (char === "{") braceDepth += 1;
		if (char === "}" && braceDepth > 0) braceDepth -= 1;
		if (char === "[") bracketDepth += 1;
		if (char === "]" && bracketDepth > 0) bracketDepth -= 1;
		if (char === "(") parenDepth += 1;
		if (char === ")" && parenDepth > 0) parenDepth -= 1;

		if (
			char === separator &&
			angleDepth === 0 &&
			braceDepth === 0 &&
			bracketDepth === 0 &&
			parenDepth === 0
		) {
			parts.push(source.slice(start, index));
			start = index + 1;
		}
	}

	parts.push(source.slice(start));
	return parts;
}

function compactWhitespace(source) {
	return source.replaceAll(TYPE_NORMALIZE_PATTERN, " ").trim();
}

function normalizeType(typeText) {
	return compactWhitespace(typeText)
		.replaceAll(/'[A-Za-z_][A-Za-z0-9_]*/gu, "lifetime")
		.replaceAll(/\s*([<>,[\]|&])\s*/gu, "$1")
		.replaceAll(/\s+/gu, " ");
}

function normalizeBody(body) {
	return body
		.replaceAll(STRING_PATTERN, "STR")
		.replaceAll(NUMBER_PATTERN, "NUM")
		.replaceAll(IDENTIFIER_PATTERN, "ID")
		.replaceAll(/\s+/gu, "")
		.trim();
}

function tokenCount(normalizedBody) {
	return normalizedBody.split(TOKEN_SPLIT_PATTERN).filter(Boolean).length;
}

function parseParameters(parameterText, language) {
	const splittableText =
		language === "rust"
			? parameterText.replaceAll(/'[A-Za-z_][A-Za-z0-9_]*/gu, "lifetime")
			: parameterText;
	return splitTopLevel(splittableText, ",", {
		singleQuote: language !== "rust",
	})
		.map((parameter) => parameter.trim())
		.filter(Boolean)
		.map((parameter) => {
			if (language === "rust") {
				const rustMatch = parameter.match(RUST_PARAMETER_PATTERN);
				return rustMatch
					? { name: rustMatch[1], typeText: normalizeType(rustMatch[2]) }
					: { name: parameter, typeText: "" };
			}

			const tsMatch = parameter.match(TYPESCRIPT_TYPED_PARAMETER_PATTERN);
			if (tsMatch) {
				return { name: tsMatch[1], typeText: normalizeType(tsMatch[2]) };
			}

			const tsDefaultMatch = parameter.match(
				TYPESCRIPT_DEFAULT_PARAMETER_PATTERN,
			);
			return tsDefaultMatch
				? { name: tsDefaultMatch[1], typeText: "" }
				: { name: parameter, typeText: "" };
		});
}

function returnTypeAfter(source, parameterCloseIndex, language) {
	const between = source.slice(
		parameterCloseIndex + 1,
		source.indexOf("{", parameterCloseIndex),
	);
	if (language === "rust") {
		const match = between.match(RUST_RETURN_TYPE_PATTERN);
		return match ? normalizeType(match[1]) : "";
	}
	const match = between.match(TYPESCRIPT_RETURN_TYPE_PATTERN);
	return match ? normalizeType(match[1]) : "";
}

function extractFunctions(file) {
	const patterns =
		file.language === "rust"
			? [RUST_FUNCTION_PATTERN]
			: [TYPESCRIPT_FUNCTION_PATTERN, TYPESCRIPT_ARROW_PATTERN];
	const functions = [];

	for (const pattern of patterns) {
		pattern.lastIndex = 0;
		for (const match of file.source.matchAll(pattern)) {
			const name = match[1];
			const parameterOpenIndex = file.source.indexOf(
				"(",
				match.index + match[0].lastIndexOf(name),
			);
			const parameterCloseIndex = matchingIndex(
				file.source,
				parameterOpenIndex,
				"(",
				")",
				{ singleQuote: file.language !== "rust" },
			);
			if (parameterOpenIndex < 0 || parameterCloseIndex < 0) {
				continue;
			}

			const bodyOpenIndex = file.source.indexOf("{", parameterCloseIndex);
			if (bodyOpenIndex < 0) {
				continue;
			}

			const bodyCloseIndex = matchingIndex(
				file.source,
				bodyOpenIndex,
				"{",
				"}",
				{ singleQuote: file.language !== "rust" },
			);
			if (bodyCloseIndex < 0) {
				continue;
			}

			const parameterText = file.source.slice(
				parameterOpenIndex + 1,
				parameterCloseIndex,
			);
			const body = file.source.slice(bodyOpenIndex + 1, bodyCloseIndex);
			functions.push({
				path: file.path,
				language: file.language,
				name,
				isPublic: functionMatchIsPublic(match[0], file.language),
				startLine: lineNumber(file.source, match.index),
				endLine: lineNumber(file.source, bodyCloseIndex),
				isTestOnly: hasCfgTestAttribute(file.source, match.index),
				parameters: parseParameters(parameterText, file.language),
				returnType: returnTypeAfter(
					file.source,
					parameterCloseIndex,
					file.language,
				),
				body,
				source: file.source.slice(match.index, bodyCloseIndex + 1),
			});
		}
	}

	return functions.sort((first, second) => first.startLine - second.startLine);
}

function functionMatchIsPublic(matchText, language) {
	const trimmed = matchText.trimStart();
	return language === "rust"
		? trimmed.startsWith("pub ") ||
				trimmed.startsWith("pub(") ||
				trimmed.startsWith("pub(crate)") ||
				trimmed.startsWith("pub(super)")
		: trimmed.startsWith("export ");
}

function extractObjectShapes(file) {
	const patterns =
		file.language === "rust"
			? [RUST_STRUCT_PATTERN]
			: [TYPESCRIPT_INTERFACE_PATTERN, TYPESCRIPT_TYPE_OBJECT_PATTERN];
	const shapes = [];

	for (const pattern of patterns) {
		pattern.lastIndex = 0;
		for (const match of file.source.matchAll(pattern)) {
			const bodyOpenIndex = file.source.indexOf("{", match.index);
			const bodyCloseIndex = matchingIndex(
				file.source,
				bodyOpenIndex,
				"{",
				"}",
				{ singleQuote: file.language !== "rust" },
			);
			if (bodyOpenIndex < 0 || bodyCloseIndex < 0) {
				continue;
			}

			const body = stripComments(
				file.source.slice(bodyOpenIndex + 1, bodyCloseIndex),
			);
			const fields = splitTopLevel(body, file.language === "rust" ? "," : ";", {
				singleQuote: file.language !== "rust",
			})
				.map((field) => field.trim())
				.filter((field) => {
					if (!field) return false;
					if (file.language === "rust") {
						return RUST_FIELD_PATTERN.test(field);
					}
					return TYPESCRIPT_FIELD_PATTERN.test(field);
				});

			shapes.push({
				path: file.path,
				language: file.language,
				name: match[1],
				startLine: lineNumber(file.source, match.index),
				endLine: lineNumber(file.source, bodyCloseIndex),
				fieldCount: fields.length,
			});
		}
	}

	return shapes;
}

function collectTypeNames(files, patternForFile) {
	const byPath = new Map();
	for (const file of files) {
		const names = new Set();
		const pattern = patternForFile(file);
		pattern.lastIndex = 0;
		for (const match of file.source.matchAll(pattern)) {
			names.add(match[1]);
		}
		byPath.set(file.path, names);
	}
	return byPath;
}

function collectAliasedTypeNames(files) {
	const byPath = collectTypeNames(files, () => TYPE_ALIAS_PATTERN);
	const allNames = new Set([...byPath.values()].flatMap((names) => [...names]));
	for (const file of files) {
		byPath.set(
			file.path,
			new Set([...(byPath.get(file.path) ?? []), ...allNames]),
		);
	}
	return byPath;
}

function collectConcreteTypeNames(files) {
	const byPath = collectTypeNames(files, (file) =>
		file.language === "rust"
			? RUST_CONCRETE_TYPE_PATTERN
			: TYPESCRIPT_CONCRETE_TYPE_PATTERN,
	);
	const allNames = new Set([...byPath.values()].flatMap((names) => [...names]));
	for (const file of files) {
		byPath.set(
			file.path,
			new Set([...(byPath.get(file.path) ?? []), ...allNames]),
		);
	}
	return byPath;
}

function typeBaseName(typeText) {
	return typeText
		.replace(TYPE_REFERENCE_PREFIX_PATTERN, "")
		.replace(TYPE_GENERIC_SUFFIX_PATTERN, "")
		.replace(TYPE_ARRAY_SUFFIX_PATTERN, "");
}

function isNamedTypeReference(typeText, location, namesByPath) {
	return namesByPath.get(location.path)?.has(typeBaseName(typeText)) ?? false;
}

function isDirectNamedTypeReference(typeText, location, namesByPath) {
	if (!isNamedTypeReference(typeText, location, namesByPath)) {
		return false;
	}
	const normalized = normalizeType(typeText);
	const base = typeBaseName(normalized);
	return (
		normalized === base ||
		normalized.startsWith(`${base}<`) ||
		normalized.startsWith(`&${base}<`) ||
		normalized.startsWith(`&mut ${base}<`)
	);
}

function collectComplexTypes(functions, files, options = {}) {
	const byType = new Map();
	const aliasesByPath = collectAliasedTypeNames(files);
	const concreteTypesByPath = collectConcreteTypeNames(files);
	for (const fn of functions) {
		for (const parameter of fn.parameters) {
			recordType(
				byType,
				parameter.typeText,
				{
					path: fn.path,
					line: fn.startLine,
					owner: fn.name,
					role: `parameter ${parameter.name}`,
					isPublic: fn.isPublic,
				},
				options,
				aliasesByPath,
				concreteTypesByPath,
			);
		}
		recordType(
			byType,
			fn.returnType,
			{
				path: fn.path,
				line: fn.startLine,
				owner: fn.name,
				role: "return",
				isPublic: fn.isPublic,
			},
			options,
			aliasesByPath,
			concreteTypesByPath,
		);
	}

	return Array.from(byType.entries())
		.filter(([, locations]) => locations.length > 1)
		.map(([key, locations]) => ({
			typeText:
				options.complexTypeScope === "file"
					? key.slice(key.indexOf(":") + 1)
					: key,
			count: locations.length,
			locations,
		}))
		.sort(
			(first, second) =>
				second.count - first.count ||
				first.typeText.localeCompare(second.typeText),
		);
}

function recordType(
	byType,
	typeText,
	location,
	options = {},
	aliasesByPath = new Map(),
	concreteTypesByPath = new Map(),
) {
	if (!(typeText && COMPLEX_TYPE_PATTERN.test(typeText))) {
		return;
	}

	const normalized = normalizeType(typeText);
	if (isNamedTypeReference(normalized, location, aliasesByPath)) {
		return;
	}
	if (isDirectNamedTypeReference(normalized, location, concreteTypesByPath)) {
		return;
	}
	if (
		options.ignoreCommonComplexTypes &&
		(COMMON_COMPLEX_TYPE_PATTERN.test(normalized) ||
			SIMPLE_OPTION_TYPE_PATTERN.test(normalized) ||
			SIMPLE_RESULT_TYPE_PATTERN.test(normalized))
	) {
		return;
	}
	if (options.ignorePublicApiTypes && location.isPublic) {
		return;
	}
	const key =
		options.complexTypeScope === "file"
			? `${location.path}:${normalized}`
			: normalized;
	const locations = byType.get(key) ?? [];
	locations.push(location);
	byType.set(key, locations);
}

// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: grouping duplicate ranges keeps the emitted pair data local.
function collectDuplicateLogic(functions, options = {}) {
	const byBody = new Map();
	const minTokens = options.duplicateMinTokens ?? DUPLICATE_MIN_TOKENS;
	for (const fn of functions) {
		if (options.ignoreTestFilesForDuplicates && isTestPath(fn.path)) {
			continue;
		}
		if (options.ignoreTestFilesForDuplicates && fn.isTestOnly) {
			continue;
		}
		const normalizedBody = normalizeBody(stripComments(fn.body));
		if (tokenCount(normalizedBody) < minTokens) {
			continue;
		}

		const matches = byBody.get(normalizedBody) ?? [];
		matches.push({ ...fn, normalizedBody });
		byBody.set(normalizedBody, matches);
	}

	const duplicates = [];
	for (const matches of byBody.values()) {
		if (matches.length < 2) {
			continue;
		}

		for (let firstIndex = 0; firstIndex < matches.length; firstIndex += 1) {
			for (
				let secondIndex = firstIndex + 1;
				secondIndex < matches.length;
				secondIndex += 1
			) {
				const first = matches[firstIndex];
				const second = matches[secondIndex];
				duplicates.push({
					firstPath: first.path,
					firstName: first.name,
					firstStartLine: first.startLine,
					firstEndLine: first.endLine,
					firstSource: first.source,
					secondPath: second.path,
					secondName: second.name,
					secondStartLine: second.startLine,
					secondEndLine: second.endLine,
					secondSource: second.source,
					similarity: 1,
				});
			}
		}
	}

	return duplicates;
}

// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: suppressed and unused parameter collection share one body scan.
function collectSuppressedAndUnusedParameters(functions) {
	const suppressedParameters = [];
	const unusedParameters = [];
	for (const fn of functions) {
		const bodyForUsage = stripComments(fn.body);
		for (const parameter of fn.parameters) {
			if (
				!parameter.name ||
				parameter.name === "self" ||
				parameter.name === "&self" ||
				parameter.name === "&mut self"
			) {
				continue;
			}

			if (parameter.name.startsWith("_") && parameter.name !== "_") {
				suppressedParameters.push({
					path: fn.path,
					line: fn.startLine,
					functionName: fn.name,
					parameterName: parameter.name,
				});
			}

			const usableName = parameter.name.replace(
				LEADING_UNDERSCORES_PATTERN,
				"",
			);
			if (!usableName) {
				continue;
			}

			const usePattern = new RegExp(`\\b${escapeRegExp(usableName)}\\b`, "u");
			if (!usePattern.test(bodyForUsage)) {
				unusedParameters.push({
					path: fn.path,
					line: fn.startLine,
					functionName: fn.name,
					parameterName: parameter.name,
				});
			}
		}
	}

	return { suppressedParameters, unusedParameters };
}

function escapeRegExp(source) {
	return source.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

function collectPassThroughWrappers(functions, options = {}) {
	return functions
		.filter(
			(fn) =>
				!(
					options.ignoreTestFilesForPassThrough &&
					(isTestPath(fn.path) || fn.isTestOnly)
				),
		)
		.map((fn) => {
			const body = stripComments(fn.body)
				.trim()
				.replace(TRAILING_SEMICOLON_PATTERN, "")
				.trim();
			const rustMatch = body.match(RUST_PASS_THROUGH_PATTERN);
			const tsMatch = body.match(TYPESCRIPT_PASS_THROUGH_PATTERN);
			const match = fn.language === "rust" ? rustMatch : tsMatch;
			if (!match) {
				return undefined;
			}
			if (UPPERCASE_START_PATTERN.test(match[1])) {
				return undefined;
			}
			if (!isSingleCallBody(body, match[1])) {
				return undefined;
			}
			if (options.ignorePublicPassThroughWrappers && fn.isPublic) {
				return undefined;
			}

			return {
				path: fn.path,
				line: fn.startLine,
				name: fn.name,
				callee: match[1],
			};
		})
		.filter(Boolean);
}

function isSingleCallBody(body, callee) {
	const callStart = body.indexOf(`${callee}(`);
	if (callStart < 0) {
		return false;
	}
	const openIndex = callStart + callee.length;
	const closeIndex = matchingIndex(body, openIndex, "(", ")", {
		singleQuote: false,
	});
	if (closeIndex < 0) {
		return false;
	}
	const tail = body.slice(closeIndex + 1).trim();
	return tail === "" || tail === "?";
}

function isTestPath(filePath) {
	return (
		filePath.includes("/tests/") ||
		filePath.endsWith("/tests.rs") ||
		filePath.endsWith(".test.ts")
	);
}

export function analyzeSources(files, options = {}) {
	const parsedFiles = files.map((file) => ({
		...file,
		source: file.source.replaceAll("\r\n", "\n"),
	}));
	const functions = parsedFiles.flatMap(extractFunctions);
	const objectShapes = parsedFiles.flatMap(extractObjectShapes);
	const oversizedFunctions = functions
		.filter((fn) => fn.parameters.length > MAX_PARAMETERS)
		.map((fn) => ({
			path: fn.path,
			language: fn.language,
			name: fn.name,
			line: fn.startLine,
			parameterCount: fn.parameters.length,
		}));
	const oversizedShapes = objectShapes.filter(
		(shape) => shape.fieldCount > MAX_FIELDS,
	);
	const { suppressedParameters, unusedParameters } =
		collectSuppressedAndUnusedParameters(functions);

	return {
		duplicateLogic: collectDuplicateLogic(functions, options),
		repeatedComplexTypes: collectComplexTypes(functions, parsedFiles, options),
		oversizedShapes,
		oversizedFunctions,
		unusedParameters,
		suppressedParameters,
		passThroughWrappers: collectPassThroughWrappers(functions, options),
	};
}

function runDiff(
	firstLabel,
	firstSource,
	secondLabel,
	secondSource,
	diffCommand,
) {
	const tempDir = fs.mkdtempSync(
		path.join(os.tmpdir(), "versionlens-quality-"),
	);
	const firstPath = path.join(tempDir, "first.txt");
	const secondPath = path.join(tempDir, "second.txt");
	fs.writeFileSync(firstPath, firstSource);
	fs.writeFileSync(secondPath, secondSource);
	const result = spawnSync(diffCommand, ["-u", firstPath, secondPath], {
		encoding: "utf8",
	});
	fs.rmSync(tempDir, { recursive: true, force: true });

	if (result.error) {
		return `[diff failed: ${result.error.message}]`;
	}

	return result.stdout
		.replaceAll(firstPath, firstLabel)
		.replaceAll(secondPath, secondLabel)
		.trimEnd();
}

// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: formatting stays linear by finding category.
export function formatFindings(result, options = {}) {
	const diffCommand = options.diffCommand ?? "difft";
	const lines = [];

	if (result.duplicateLogic.length > 0) {
		lines.push("duplicate logic");
		for (const duplicate of result.duplicateLogic) {
			const firstLabel = `${duplicate.firstPath}:${duplicate.firstStartLine}-${duplicate.firstEndLine} ${duplicate.firstName}`;
			const secondLabel = `${duplicate.secondPath}:${duplicate.secondStartLine}-${duplicate.secondEndLine} ${duplicate.secondName}`;
			lines.push(`- ${firstLabel}`);
			lines.push(`  ${secondLabel}`);
			lines.push(`  similarity=${duplicate.similarity.toFixed(2)}`);
			lines.push(
				runDiff(
					firstLabel,
					duplicate.firstSource,
					secondLabel,
					duplicate.secondSource,
					diffCommand,
				),
			);
		}
	}

	if (result.repeatedComplexTypes.length > 0) {
		lines.push("repeated complex types");
		for (const type of result.repeatedComplexTypes) {
			lines.push(`- ${type.typeText} count=${type.count}`);
			for (const location of type.locations) {
				lines.push(
					`  ${location.path}:${location.line} ${location.owner} ${location.role}`,
				);
			}
		}
	}

	if (
		result.oversizedShapes.length > 0 ||
		result.oversizedFunctions.length > 0
	) {
		lines.push("oversized shapes");
		for (const shape of result.oversizedShapes) {
			lines.push(
				`- ${shape.path}:${shape.startLine}-${shape.endLine} ${shape.name} fields=${shape.fieldCount}`,
			);
		}
		for (const fn of result.oversizedFunctions) {
			lines.push(
				`- ${fn.path}:${fn.line} ${fn.name} parameters=${fn.parameterCount}`,
			);
		}
	}

	if (result.unusedParameters.length > 0) {
		lines.push("unused parameters");
		for (const parameter of result.unusedParameters) {
			lines.push(
				`- ${parameter.path}:${parameter.line} ${parameter.functionName} parameter=${parameter.parameterName}`,
			);
		}
	}

	if (result.suppressedParameters.length > 0) {
		lines.push("suppressed parameters");
		for (const parameter of result.suppressedParameters) {
			lines.push(
				`- ${parameter.path}:${parameter.line} ${parameter.functionName} parameter=${parameter.parameterName}`,
			);
		}
	}

	if (result.passThroughWrappers.length > 0) {
		lines.push("pass-through wrappers");
		for (const wrapper of result.passThroughWrappers) {
			lines.push(
				`- ${wrapper.path}:${wrapper.line} ${wrapper.name} -> ${wrapper.callee}`,
			);
		}
	}

	return lines.join("\n");
}

function walk(dir, files) {
	if (!fs.existsSync(dir)) {
		return;
	}

	for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
		if (IGNORED_DIRS.has(entry.name)) {
			continue;
		}

		const filePath = path.join(dir, entry.name);
		if (entry.isDirectory()) {
			walk(filePath, files);
			continue;
		}

		const extension = path.extname(entry.name);
		if (extension === ".rs" || extension === ".ts") {
			files.push({
				path: filePath,
				language: extension === ".rs" ? "rust" : "typescript",
				source: fs.readFileSync(filePath, "utf8"),
			});
		}
	}
}

function executableExists(command) {
	const result = spawnSync("/bin/sh", ["-lc", `command -v ${command}`], {
		encoding: "utf8",
	});
	return result.status === 0;
}

function changedSourcePaths() {
	const tracked = spawnSync("git", ["diff", "--name-only", "HEAD", "--"], {
		encoding: "utf8",
	});
	const untracked = spawnSync(
		"git",
		["ls-files", "--others", "--exclude-standard"],
		{ encoding: "utf8" },
	);
	const output = `${tracked.stdout ?? ""}\n${untracked.stdout ?? ""}`;
	return output
		.split(/\r?\n/u)
		.filter(Boolean)
		.filter((filePath) => SOURCE_ROOTS.some((root) => filePath.startsWith(`${root}/`)))
		.filter((filePath) => {
			const extension = path.extname(filePath);
			return extension === ".rs" || extension === ".ts";
		})
		.filter((filePath) => !filePath.split(path.sep).some((part) => IGNORED_DIRS.has(part)));
}

function readSourceFile(filePath) {
	const extension = path.extname(filePath);
	return {
		path: filePath,
		language: extension === ".rs" ? "rust" : "typescript",
		source: fs.readFileSync(filePath, "utf8"),
	};
}

function hasFindings(result) {
	return Object.values(result).some((findings) => findings.length > 0);
}

function main() {
	const diffCommand = executableExists("difft") ? "difft" : "diff";
	if (!executableExists(diffCommand)) {
		console.error(`missing command: ${diffCommand}`);
		process.exit(1);
	}

	const files = [];
	if (Bun.argv.includes("--all")) {
		for (const root of SOURCE_ROOTS) {
			walk(root, files);
		}
	} else {
		for (const filePath of changedSourcePaths()) {
			if (fs.existsSync(filePath)) {
				files.push(readSourceFile(filePath));
			}
		}
	}

	if (files.length === 0) {
		console.error("no changed source files checked; pass --all to scan the whole repo");
		return;
	}

	const result = analyzeSources(files, {
		duplicateMinTokens: CLI_DUPLICATE_MIN_TOKENS,
		complexTypeScope: "file",
		ignoreCommonComplexTypes: true,
		ignorePublicApiTypes: true,
		ignoreTestFilesForDuplicates: true,
		ignoreTestFilesForPassThrough: true,
		ignorePublicPassThroughWrappers: true,
	});
	if (hasFindings(result)) {
		console.error(formatFindings(result, { diffCommand }));
		if (Bun.argv.includes("--fail-on-findings")) {
			process.exit(1);
		}
		console.error("findings reported; pass --fail-on-findings to fail on findings");
	}
}

if (import.meta.main) {
	main();
}
