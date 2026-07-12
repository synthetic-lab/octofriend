import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import json5 from "json5";
import {
	fixJsonPrompt,
	type JsonFixResponse,
} from "../../../packages/tui/src/runtime/prompts/autofix/main.ts";
import { tryexpr } from "../../../packages/tui/src/shell/result.ts";
import { genDiffs } from "../generate-edits.ts";
import {
	percentChance,
	pickRandom,
	randomIndex,
	randomLowercase,
	zeroToN,
} from "../random.ts";
import { cutIndex, insertAt } from "../str.ts";
import { generateJSON } from "./json-generator.ts";
import {
	type ArrayNode,
	type BooleanNode,
	type JSONASTNode,
	type NullNode,
	type NumberNode,
	type ObjectNode,
	parseJson,
	type StringNode,
} from "./json-parser.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const TRAIN_PATH = path.join(__dirname, "unfat/output/data/train.jsonl");
const EVAL_PATH = path.join(__dirname, "unfat/output/data/eval.jsonl");
const MAX_NUM_BREAKS = 3;
const MAX_AST_BREAKS = {
	null: 1,
	boolean: 1,
	number: 1,
	string: 3,
	array: 3,
	object: 3,
};
const DIFF_GEN_PERCENT = 0.02;
const EVAL_PERCENT = 0.2;
const NOT_JSON_PERCENT = 0.1;
const JSON5_PERCENT = 0.01;
const NEST_PERCENT = 0.05;
const MAX_NESTING = 5;
const NUM_GENERATED_SAMPLES = 10_000;

const REPOS_DIR = path.join(path.dirname(__dirname), "repos");

async function main(): Promise<GenResult<void>> {
	await Promise.all([
		fs.rm(TRAIN_PATH, { force: true }),
		fs.rm(EVAL_PATH, { force: true }),
	]);
	await fs.mkdir(path.dirname(TRAIN_PATH), { recursive: true });
	await fs.writeFile(TRAIN_PATH, "");
	await fs.writeFile(EVAL_PATH, "");

	let genResult = await genBrokenJsonFromArray("Number", [-1111.8]);
	if (!genResult.success) return genResult;
	console.log("Generating synthetic JSON...");
	const samples: unknown[] = [];
	for (let i = 0; i < NUM_GENERATED_SAMPLES; i++) {
		samples.push(JSON.parse(generateJSON(false)));
		if (i % 200 === 0) console.log(`Generated ${i}...`);
	}
	console.log("Synth data generated; breaking...");
	genResult = await genBrokenJsonFromArray("Generated JSON", samples);
	if (!genResult.success) return genResult;

	const pokedex = JSON.parse(
		await fs.readFile(
			path.join(__dirname, "json-repos/pokedex/pokedex.json"),
			"utf8",
		),
	);
	genResult = await genBrokenJsonFromArray("Pokedex", pokedex["pokemon"]);
	if (!genResult.success) return genResult;

	const reps = JSON.parse(
		await fs.readFile(
			path.join(__dirname, "json-repos/us-representatives.json"),
			"utf8",
		),
	);
	genResult = await genBrokenJsonFromArray(
		"US Representatives",
		reps["objects"],
	);
	if (!genResult.success) return genResult;

	const reddit = await fs.readdir(path.join(__dirname, "json-repos/reddit"));
	for (const redditJson of reddit) {
		const parsed = JSON.parse(
			await fs.readFile(
				path.join(__dirname, "json-repos/reddit", redditJson),
				"utf8",
			),
		);
		genResult = await genBrokenJsonFromArray(
			`/r/${redditJson}`,
			parsed["data"]["children"],
		);
		if (!genResult.success) return genResult;
	}

	const movies2010 = JSON.parse(
		await fs.readFile(
			path.join(__dirname, "json-repos/wikipedia-movie-data/movies-2010s.json"),
			"utf8",
		),
	);
	genResult = await genBrokenJsonFromArray("Movies (2010s)", movies2010);
	if (!genResult.success) return genResult;

	const movies2020 = JSON.parse(
		await fs.readFile(
			path.join(__dirname, "json-repos/wikipedia-movie-data/movies-2020s.json"),
			"utf8",
		),
	);
	genResult = await genBrokenJsonFromArray("Movies (2020s)", movies2020);
	if (!genResult.success) return genResult;

	const repos = await fs.readdir(REPOS_DIR);
	for (const repo of repos) {
		console.log("Generating broken JSON for", repo);
		genResult = await genBrokenJsonForRepo(path.join(REPOS_DIR, repo));
		if (!genResult.success) return genResult;
	}

	return ok(undefined);
}

async function genBrokenJsonFromArray(
	name: string,
	array: unknown[],
): Promise<GenResult<void>> {
	let count = 0;
	for await (const obj of array) {
		count++;
		const sampleResult = randomlyBreak(JSON.stringify(obj));
		if (!sampleResult.success) return sampleResult;
		const sample = sampleResult.value;
		const outputPath = percentChance(EVAL_PERCENT) ? EVAL_PATH : TRAIN_PATH;
		const messages = [
			{
				role: "user",
				content: fixJsonPrompt(sample.input),
			},
			{
				role: "assistant",
				content: sample.groundTruth,
			},
		];
		await fs.appendFile(
			outputPath,
			`${JSON.stringify({
				messages,
			})}\n`,
			"utf8",
		);
		if (count % 200 === 0) console.log(`Broke ${count}...`);
	}
	console.log(`Generated ${count} samples for`, name);
	return ok(undefined);
}

async function genBrokenJsonForRepo(path: string): Promise<GenResult<void>> {
	let count = 0;
	for await (const sampleResult of getSamplesForRepo(path)) {
		if (!sampleResult.success) return sampleResult;
		const sample = sampleResult.value;
		count++;
		const outputPath = Math.random() > EVAL_PERCENT ? TRAIN_PATH : EVAL_PATH;
		const messages = [
			{
				role: "user",
				content: fixJsonPrompt(sample.input),
			},
			{
				role: "assistant",
				content: sample.groundTruth,
			},
		];
		await fs.appendFile(
			outputPath,
			`${JSON.stringify({
				messages,
			})}\n`,
			"utf8",
		);
	}
	console.log(`Broke and stored ${count} samples for`, path);
	return ok(undefined);
}

type GenResult<T> =
	| { success: true; value: T }
	| { success: false; error: string };

function ok<T>(value: T): GenResult<T> {
	return { success: true, value };
}

function err(error: string): GenResult<never> {
	return { success: false, error };
}

type Sample = {
	input: string;
	groundTruth: string;
};

type CreateArguments = {
	filePath: string;
	content: string;
};

async function* getSamplesForRepo(
	dirpath: string,
): AsyncGenerator<GenResult<Sample>> {
	for await (const diff of genDiffs(path.join(dirpath, ".git"))) {
		if (!percentChance(DIFF_GEN_PERCENT)) continue;
		yield randomlyBreak(JSON.stringify(diff));
	}

	for await (const sourceFile of getSourceFiles(dirpath)) {
		const file = await fs.readFile(sourceFile, "utf8");
		const [err, _] = tryexpr(() => JSON.parse(file));

		if (err == null) {
			yield randomlyBreak(file);
			continue;
		}

		if (percentChance(NOT_JSON_PERCENT)) {
			yield ok({
				input: file,
				groundTruth: JSON.stringify({
					success: false,
				} satisfies JsonFixResponse),
			});
			continue;
		}

		const createEdit: CreateArguments = {
			filePath: sourceFile,
			content: file,
		};
		yield randomlyBreak(JSON.stringify(createEdit));
	}
}

const keyNamePool: string[] = [
	"id",
	"name",
	"type",
	"status",
	"value",
	"count",
	"items",
	"metadata",
	"createdAt",
	"updatedAt",
	"source",
	"target",
	"config",
	"settings",
	"children",
	"description",
];

type OutputNode =
	| {
			node: JSONASTNode;
			brokenNode: null;
	  }
	| {
			node: null;
			brokenNode: BreakValue;
	  };

function randomlyBreak(str: string): GenResult<Sample> {
	if (percentChance(JSON5_PERCENT)) {
		return ok({
			input: json5.stringify(JSON.parse(str)),
			groundTruth: JSON.stringify({
				success: true,
				fixed: JSON.parse(str),
			} satisfies JsonFixResponse),
		});
	}
	let original = str;

	if (percentChance(NEST_PERCENT)) {
		const nestcount = zeroToN(MAX_NESTING);
		for (let i = 0; i < nestcount; i++) {
			const key = pickRandom(keyNamePool);
			original = JSON.stringify({ [key]: original });
		}
	}

	const broken = breakStr(original);
	if (!broken.success) return broken;

	return ok({
		input: broken.value,
		groundTruth: JSON.stringify({
			success: true,
			fixed: JSON.parse(original),
		} satisfies JsonFixResponse),
	});
}

function breakStr(str: string): GenResult<string> {
	let broken = str;
	const ast = parseJson(str);

	function isBroken() {
		const [err] = tryexpr(() => JSON.parse(broken));
		return err != null;
	}

	while (!isBroken()) {
		const brokenNodeCount = Math.min(zeroToN(MAX_NUM_BREAKS), ast.length);
		const indexesToBreak = new Set<number>();
		for (let i = 0; i < brokenNodeCount; i++) {
			indexesToBreak.add(randomIndex(ast));
		}

		const outputNodes = buildOutputNodes(ast, indexesToBreak);
		if (!outputNodes.success) return outputNodes;

		const stringified = stringify(ast[ast.length - 1], outputNodes.value);
		if (!stringified.success) return stringified;
		broken = stringified.value;
	}

	return ok(broken);
}

function buildOutputNodes(
	ast: JSONASTNode[],
	indexesToBreak: Set<number>,
): GenResult<OutputNode[]> {
	const outputNodes: OutputNode[] = [];
	for (let index = 0; index < ast.length; index++) {
		const outputNode = buildOutputNode(ast[index], indexesToBreak.has(index));
		if (!outputNode.success) return outputNode;
		outputNodes.push(outputNode.value);
	}
	return ok(outputNodes);
}

function buildOutputNode(
	node: JSONASTNode,
	shouldBreak: boolean,
): GenResult<OutputNode> {
	if (!shouldBreak) return ok({ node, brokenNode: null });

	const initial = initialBreak(node);
	if (!initial.success) return initial;

	const numBreaks = zeroToN(MAX_AST_BREAKS[node.type]);
	let prev: BreakValue = initial.value;
	for (let i = 0; i < numBreaks; i++) {
		const typebreaks = astBreaks[node.type] as Breaker<JSONASTNode["type"]>[];
		const typebreaker = pickRandom(typebreaks);
		const next = typebreaker(prev);
		if (next != null) prev = next;
	}
	return ok({ node: null, brokenNode: prev });
}

function stringify(
	original: JSONASTNode,
	outputNodes: OutputNode[],
): GenResult<string> {
	const matchingOutputNode = outputNodes.find((output) => {
		if (output.node != null) return output.node === original;
		return output.brokenNode.node === original;
	});
	if (matchingOutputNode == null) {
		return err("Couldn't find matching output node");
	}

	const { node, brokenNode } = matchingOutputNode;
	if (node) return stringifyNode(node, outputNodes);
	if (brokenNode.type === "string") return ok(brokenNode.broken);
	if (brokenNode.type === "null") return ok(brokenNode.broken);
	if (brokenNode.type === "number") return ok(brokenNode.broken);
	if (brokenNode.type === "boolean") return ok(brokenNode.broken);
	if (brokenNode.type === "array") {
		return stringifyBrokenArray(brokenNode, outputNodes);
	}
	return stringifyBrokenObject(brokenNode, outputNodes);
}

function stringifyBrokenArray(
	brokenNode: Extract<BreakValue, { type: "array" }>,
	outputNodes: OutputNode[],
): GenResult<string> {
	const arr: string[] = [];
	if (!brokenNode.broken.openCut) arr.push("[");
	for (let i = 0; i < brokenNode.node.children.length; i++) {
		const child = brokenNode.node.children[i];
		arr.push(randomWhitespace());
		const childResult = stringify(child, outputNodes);
		if (!childResult.success) return childResult;
		arr.push(childResult.value);
		arr.push(randomWhitespace());
		pushOptionalComma(
			arr,
			i,
			brokenNode.node.children.length,
			brokenNode.broken,
		);
	}
	if (!brokenNode.broken.closeCut) arr.push("]");
	return ok(arr.join(""));
}

function stringifyBrokenObject(
	brokenNode: Extract<BreakValue, { type: "object" }>,
	outputNodes: OutputNode[],
): GenResult<string> {
	const obj: string[] = [];
	if (!brokenNode.broken.openCut) obj.push("{");
	for (let i = 0; i < brokenNode.node.children.length; i++) {
		const [key, value] = brokenNode.node.children[i];
		obj.push(randomWhitespace());
		const keyResult = stringify(key, outputNodes);
		if (!keyResult.success) return keyResult;
		obj.push(keyResult.value);
		if (!brokenNode.broken.colonCuts.has(i)) obj.push(":");
		if (brokenNode.broken.colonDupes.has(i)) obj.push(":");
		obj.push(randomWhitespace());
		const valueResult = stringify(value, outputNodes);
		if (!valueResult.success) return valueResult;
		obj.push(valueResult.value);
		obj.push(randomWhitespace());
		pushOptionalComma(
			obj,
			i,
			brokenNode.node.children.length,
			brokenNode.broken,
		);
	}
	if (!brokenNode.broken.closeCut) obj.push("}");
	return ok(obj.join(""));
}

function pushOptionalComma(
	output: string[],
	index: number,
	length: number,
	broken: { commaCuts: Set<number>; commaDupes: Set<number> },
): void {
	if (index !== length - 1 && !broken.commaCuts.has(index)) output.push(",");
	if (broken.commaDupes.has(index)) output.push(",");
}

function stringifyNode(
	node: JSONASTNode,
	outputNodes: OutputNode[],
): GenResult<string> {
	switch (node.type) {
		case "string":
		case "null":
		case "number":
		case "boolean":
			return ok(JSON.stringify(node.value));

		case "array":
			return stringifyArrayNode(node, outputNodes);

		case "object":
			return stringifyObjectNode(node, outputNodes);
		default:
			return err(`Unsupported JSON AST node type: ${String(node.type)}`);
	}
}

function stringifyArrayNode(
	node: ArrayNode,
	outputNodes: OutputNode[],
): GenResult<string> {
	const arr = ["["];
	if (node.children.length === 0) arr.push(randomWhitespace());
	else {
		const children: string[] = [];
		for (const child of node.children) {
			const childResult = stringify(child, outputNodes);
			if (!childResult.success) return childResult;
			children.push(
				randomWhitespace() + childResult.value + randomWhitespace(),
			);
		}
		arr.push(children.join(","));
	}
	arr.push("]");
	return ok(arr.join(""));
}

function stringifyObjectNode(
	node: ObjectNode,
	outputNodes: OutputNode[],
): GenResult<string> {
	const obj = ["{"];
	if (node.children.length === 0) obj.push(randomWhitespace());
	else {
		const children: string[] = [];
		for (const [k, v] of node.children) {
			const child = stringifyObjectChild(k, v, outputNodes);
			if (!child.success) return child;
			children.push(child.value);
		}
		obj.push(children.join(","));
	}
	obj.push("}");
	return ok(obj.join(""));
}

function stringifyObjectChild(
	key: StringNode,
	value: JSONASTNode,
	outputNodes: OutputNode[],
): GenResult<string> {
	const keyResult = stringify(key, outputNodes);
	if (!keyResult.success) return keyResult;
	const valueResult = stringify(value, outputNodes);
	if (!valueResult.success) return valueResult;
	return ok(
		[
			randomWhitespace(),
			keyResult.value,
			randomWhitespace(),
			":",
			randomWhitespace(),
			valueResult.value,
			randomWhitespace(),
		].join(""),
	);
}

const MAX_WHITESPACE = 5;
const SPACE_PERCENT = 0.7;
function randomWhitespace() {
	const numws = zeroToN(MAX_WHITESPACE);
	const whitespace: string[] = [];
	for (let i = 0; i < numws; i++) {
		if (percentChance(SPACE_PERCENT)) whitespace.push(" ");
		else whitespace.push("\n");
	}
	return whitespace.join("");
}

type BreakResult = {
	null: {
		type: "null";
		broken: string;
		node: NullNode;
	};
	boolean: {
		type: "boolean";
		broken: string;
		node: BooleanNode;
	};
	number: {
		type: "number";
		broken: string;
		node: NumberNode;
	};
	string: {
		type: "string";
		broken: string;
		node: StringNode;
	};
	array: {
		type: "array";
		broken: {
			commaCuts: Set<number>;
			commaDupes: Set<number>;
			openCut: boolean;
			closeCut: boolean;
		};
		node: ArrayNode;
	};
	object: {
		type: "object";
		broken: {
			colonCuts: Set<number>;
			colonDupes: Set<number>;
			commaCuts: Set<number>;
			commaDupes: Set<number>;
			openCut: boolean;
			closeCut: boolean;
		};
		node: ObjectNode;
	};
};
type BreakValue = BreakResult[JSONASTNode["type"]];
export type BreakNode<K extends keyof BreakResult> = BreakResult[K];

function initialBreak<T extends JSONASTNode>(node: T): GenResult<BreakValue> {
	switch (node.type) {
		case "null":
			return ok({ type: "null", node, broken: "null" });
		case "boolean":
			return ok({
				type: "boolean",
				node,
				broken: node.value ? "true" : "false",
			});
		case "number":
			return ok({ type: "number", node, broken: JSON.stringify(node.value) });
		case "string":
			return ok({ type: "string", node, broken: JSON.stringify(node.value) });
		case "array":
			return ok({
				type: "array",
				node,
				broken: {
					commaCuts: new Set(),
					commaDupes: new Set(),
					openCut: false,
					closeCut: false,
				},
			});
		case "object":
			return ok({
				type: "object",
				node,
				broken: {
					commaCuts: new Set(),
					commaDupes: new Set(),
					colonCuts: new Set(),
					colonDupes: new Set(),
					openCut: false,
					closeCut: false,
				},
			});
		default:
			return err(`Unsupported JSON AST node type: ${String(node.type)}`);
	}
}

type Breaker<K extends JSONASTNode["type"]> = (
	prev: BreakResult[K],
) => BreakResult[K] | null;
const astBreaks: { [K in JSONASTNode["type"]]: Breaker<K>[] } = {
	null: [],
	boolean: [],
	number: [],
	string: [],
	array: [],
	object: [],
};

function savePush<T>(arr: T[], item: T): T {
	arr.push(item);
	return item;
}

function stringBreak<T extends { broken: string }>(t: T): T | null {
	const [err] = tryexpr(() => JSON.parse(t.broken));
	if (err) return t;
	return null;
}

/*
 * AST-based JSON mangling functions
 */
// Nulls
export const nullCut = savePush(astBreaks.null, (prev) => {
	return stringBreak({
		...prev,
		broken: cutIndex(prev.broken, randomIndex(prev.broken)),
	});
});
export const nullAdd = savePush(astBreaks.null, (prev) => {
	return stringBreak({
		...prev,
		broken: insertAt(prev.broken, randomIndex(prev.broken), randomLowercase()),
	});
});

// Bools
export const boolCut = savePush(astBreaks.boolean, (prev) => {
	return stringBreak({
		...prev,
		broken: cutIndex(prev.broken, randomIndex(prev.broken)),
	});
});
export const boolAdd = savePush(astBreaks.boolean, (prev) => {
	return stringBreak({
		...prev,
		broken: insertAt(prev.broken, randomIndex(prev.broken), randomLowercase()),
	});
});

// Numbers
export const numberDot = savePush(astBreaks.number, (prev) => {
	return stringBreak({ ...prev, broken: `${prev.broken}.` });
});

// Strings
export const strUnescape = savePush(astBreaks.string, (prev) => {
	const indexes = findEscaped(prev.broken, ["n", '"']);
	return stringBreak({
		...prev,
		broken: cutIndex(prev.broken, pickRandom(indexes)),
	});
});
export const strRemoveQuote = savePush(astBreaks.string, (prev) => {
	const indexes = findUnescaped(prev.broken, ['"']);
	return stringBreak({
		...prev,
		broken: cutIndex(prev.broken, pickRandom(indexes)),
	});
});
export const strEscapeQuote = savePush(astBreaks.string, (prev) => {
	const indexes = findUnescaped(prev.broken, ['"']);
	return stringBreak({
		...prev,
		broken: insertAt(prev.broken, pickRandom(indexes) - 1, "\\"),
	});
});
export const strPrefixQuote = savePush(astBreaks.string, (prev) => {
	return stringBreak({ ...prev, broken: `"${prev.broken}` });
});
export const strPostfixQuote = savePush(astBreaks.string, (prev) => {
	return stringBreak({ ...prev, broken: `${prev.broken}"` });
});

// Array and object shared mangling
type HasCommaPos = { commaPositions: number[] };
type HasCommaBreak = {
	node: HasCommaPos;
	broken: { commaCuts: Set<number>; commaDupes: Set<number> };
};
function remainingCommas(prev: HasCommaBreak) {
	return prev.node.commaPositions
		.map((_, i) => i)
		.filter((i) => !prev.broken.commaCuts.has(i))
		.filter((i) => !prev.broken.commaDupes.has(i));
}

export function cutComma<P extends HasCommaBreak>(prev: P): P | null {
	const remaining = remainingCommas(prev);
	if (remaining.length === 0) return null;
	return {
		...prev,
		broken: {
			...prev.broken,
			commaCuts: new Set([...prev.broken.commaCuts, pickRandom(remaining)]),
		},
	};
}
export function dupeComma<P extends HasCommaBreak>(prev: P): P | null {
	const remaining = remainingCommas(prev);
	if (remaining.length === 0) return null;
	return {
		...prev,
		commaDupes: new Set([...prev.broken.commaCuts, pickRandom(remaining)]),
	};
}
type HasCutBreak = { broken: { closeCut: boolean; openCut: boolean } };
export function cutClose<P extends HasCutBreak>(prev: P): P | null {
	if (prev.broken.closeCut || prev.broken.openCut) return null;
	return { ...prev, broken: { ...prev.broken, closeCut: true } };
}
export function cutOpen<P extends HasCutBreak>(prev: P): P | null {
	if (prev.broken.closeCut || prev.broken.openCut) return null;
	return { ...prev, broken: { ...prev.broken, openCut: true } };
}
const CONTAINER_BREAKS = [cutComma, dupeComma, cutClose, cutOpen] as const;

for (const breakfn of CONTAINER_BREAKS) {
	astBreaks.array.push(breakfn);
	astBreaks.object.push(breakfn);
}

// Object-specific mangling
function remainingColons(prev: BreakResult["object"]) {
	return prev.node.colonPositions
		.map((_, i) => i)
		.filter((i) => !prev.broken.colonCuts.has(i))
		.filter((i) => !prev.broken.colonDupes.has(i));
}
export const cutColon = savePush(astBreaks.object, (prev) => {
	const remaining = remainingColons(prev);
	if (remaining.length === 0) return null;
	return {
		...prev,
		broken: {
			...prev.broken,
			colonCuts: new Set([...prev.broken.colonCuts, pickRandom(remaining)]),
		},
	};
});
export const dupeColon = savePush(astBreaks.object, (prev) => {
	const remaining = remainingColons(prev);
	if (remaining.length === 0) return null;
	return {
		...prev,
		broken: {
			...prev.broken,
			colonDupes: new Set([...prev.broken.colonCuts, pickRandom(remaining)]),
		},
	};
});

function findJsonIndexes(source: string, escaped: boolean, strings: string[]) {
	const search = new Set(strings);
	let isEscaped = false;
	const indexes: number[] = [];

	for (let i = 0; i < source.length; i++) {
		const char = source[i];
		if (char === "\\") isEscaped = !isEscaped;
		if (search.has(char) && escaped === isEscaped) indexes.push(i);
		if (char !== "\\") isEscaped = false;
	}

	return indexes;
}

function findEscaped(source: string, strings: string[]) {
	return findJsonIndexes(source, true, strings);
}
function findUnescaped(source: string, strings: string[]) {
	return findJsonIndexes(source, false, strings);
}

const SOURCE_FILE_EXTS = new Set([
	"js",
	"css",
	"ts",
	"jsx",
	"tsx",
	"rb",
	"py",
	"rs",
	"c",
	"cpp",
	"h",
	"toml",
	"md",
	"yml",
	"yaml",
	"ini",
	"pylintrc",
	"txt",
	"rst",
	"rspec",
	"jshintrc",
	"prettierignore",
	"npmrc",
	"spec",
	"gitignore",
	"yardopts",
	"simplecov",
	"gemspec",
	"in",
	"nix",
	"lua",
]);
const SPECIAL_SOURCE_FILES = new Set([
	"Gemfile",
	"Rakefile",
	"CODEOWNERS",
	"AUTHORS",
	"LICENSE",
	"OWNERS",
	"release-notes",
]);

async function* getSourceFiles(dirpath: string): AsyncGenerator<string> {
	const direntries = await fs.readdir(dirpath);
	for (const entry of direntries) {
		const fullpath = path.join(dirpath, entry);
		const stat = await fs.stat(fullpath);
		if (stat.isFile() && isSourceFileName(entry)) yield fullpath;
		if (stat.isDirectory() && entry[0] !== ".") {
			yield* await getSourceFiles(fullpath);
		}
	}
}

function isSourceFileName(entry: string): boolean {
	if (SPECIAL_SOURCE_FILES.has(entry)) return true;
	if (!entry.includes(".")) return false;
	const pieces = entry.split(".");
	const ext = pieces[pieces.length - 1];
	return SOURCE_FILE_EXTS.has(ext);
}

main()
	.then((result) => {
		if (!result.success) {
			console.error(result.error);
			process.exitCode = 1;
		}
	})
	.catch((error: unknown) => {
		console.error(error);
		process.exitCode = 1;
	});
