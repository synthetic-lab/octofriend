#!/usr/bin/env bun
import { cp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { performance } from "node:perf_hooks";
import type { AgentdRustBridge } from "../../packages/octofwen-cli/src/bridge/rust/agent.ts";
import type {
	Config,
	ModelConfig,
} from "../../packages/octofwen-cli/src/configuration/schemas.ts";
import type { Transport } from "../../packages/octofwen-cli/src/transport/common.ts";

type Args = {
	benchmarksDir: string;
	config?: string;
	dryRun: boolean;
	exercisesDir: string;
	keywords?: string;
	languages?: string;
	maxToolIterations: number;
	model?: string;
	purgeExercisesDirBeforeRun: boolean;
	requestTimeoutMs: number;
	name: string;
	numTests: number;
	testTimeoutMs: number;
	tries: number;
};

type SnapshotFile = {
	relativePath: string;
	contents: Uint8Array;
};

type Exercise = {
	language: string;
	name: string;
	relativePath: string;
	sourcePath: string;
	files?: SnapshotFile[];
};

type ExerciseFileSets = {
	solutionFiles: string[];
	testFiles: string[];
	exampleFiles: string[];
	invalidatorFiles: string[];
};

type ToolCall = {
	type: "tool-call";
	name: string;
	toolCallId: string;
	parsed: Record<string, unknown>;
	original: unknown;
};

type RunResult = {
	command: string;
	durationMs: number;
	ok: boolean;
	output: string;
};

type CaseResult = {
	testcase: string;
	language: string;
	model: string;
	tries: number;
	tests_outcomes: boolean[];
	test_outputs: string[];
	duration: number;
	command: string;
};

const DEFAULT_ARGS: Args = {
	benchmarksDir: "tmp.benchmarks",
	dryRun: false,
	exercisesDir: "tmp.benchmarks/polyglot-benchmark",
	maxToolIterations: 80,
	name: "octofwen-polyglot",
	numTests: -1,
	purgeExercisesDirBeforeRun: false,
	requestTimeoutMs: 1_800_000,
	testTimeoutMs: 600_000,
	tries: 2,
};

const args = parseArgs(process.argv.slice(2));
const exercises = await selectExercises(args);
if (args.dryRun) {
	for (const exercise of exercises) console.log(exercise.relativePath);
	process.exit(0);
}

await snapshotExercises(exercises);
if (args.purgeExercisesDirBeforeRun) {
	await rm(args.exercisesDir, { recursive: true, force: true });
}

const [
	{ createAgentdRustBridge },
	{ loadConfigWithoutReauth },
	{ readKeyForModelWithDetails },
	{ selectModel },
] = await Promise.all([
	import("../../packages/octofwen-cli/src/bridge/rust/agent.ts"),
	import("../../packages/octofwen-cli/src/config.tsx"),
	import("../../packages/octofwen-cli/src/configuration/keys.ts"),
	import("../../packages/octofwen-cli/src/model-selection.ts"),
]);
const loaded = await loadConfigWithoutReauth(
	args.config ?? process.env["OCTOFWEN_CONFIG"],
);
const config = loaded.config;
const model = selectModel(config, args.model);
if (model == null) {
	console.error(
		args.model ? `No model named ${args.model}` : "No default model configured",
	);
	process.exit(1);
}

const keyResult = await readKeyForModelWithDetails(model, config);
if (!keyResult.ok || keyResult.key.length === 0) {
	console.error(`${model.nickname} does not have a usable API key configured.`);
	process.exit(1);
}

const runDir = await createRunDir(args.benchmarksDir, args.name);
console.log(`Writing benchmark run to ${runDir}`);

const bridge = await createAgentdRustBridge();
try {
	const results: CaseResult[] = [];
	for (const exercise of exercises) {
		const result = await runExerciseSafely({
			args,
			bridge,
			config,
			exercise,
			model,
			runDir,
			apiKey: keyResult.key,
		});
		results.push(result);
		await writeFile(
			path.join(runDir, "results.json"),
			JSON.stringify(results, null, 2),
		);
		reportProgress(results, exercises.length);
	}
} finally {
	bridge.close();
}

function parseArgs(argv: string[]): Args {
	const parsed: Args = { ...DEFAULT_ARGS };
	for (let index = 0; index < argv.length; index += 1) {
		const arg = argv[index];
		const value = argv[index + 1];
		switch (arg) {
			case "--benchmarks-dir":
				parsed.benchmarksDir = requiredValue(arg, value);
				index += 1;
				break;
			case "--config":
				parsed.config = requiredValue(arg, value);
				index += 1;
				break;
			case "--dry-run":
				parsed.dryRun = true;
				break;
			case "--exercises-dir":
				parsed.exercisesDir = requiredValue(arg, value);
				index += 1;
				break;
			case "--keywords":
				parsed.keywords = requiredValue(arg, value);
				index += 1;
				break;
			case "--languages":
				parsed.languages = requiredValue(arg, value);
				index += 1;
				break;
			case "--max-tool-iterations":
				parsed.maxToolIterations = positiveInt(arg, requiredValue(arg, value));
				index += 1;
				break;
			case "--model":
				parsed.model = requiredValue(arg, value);
				index += 1;
				break;
			case "--purge-exercises-dir-before-run":
				parsed.purgeExercisesDirBeforeRun = true;
				break;
			case "--name":
				parsed.name = requiredValue(arg, value);
				index += 1;
				break;
			case "--num-tests":
				parsed.numTests = Number.parseInt(requiredValue(arg, value), 10);
				index += 1;
				break;
			case "--request-timeout-ms":
				parsed.requestTimeoutMs = positiveInt(arg, requiredValue(arg, value));
				index += 1;
				break;
			case "--test-timeout-ms":
				parsed.testTimeoutMs = positiveInt(arg, requiredValue(arg, value));
				index += 1;
				break;
			case "--tries":
				parsed.tries = positiveInt(arg, requiredValue(arg, value));
				index += 1;
				break;
			case "--help":
				printHelp();
				process.exit(0);
			default:
				console.error(`Unknown argument: ${arg}`);
				printHelp();
				process.exit(1);
		}
	}
	return parsed;
}

function requiredValue(flag: string, value: string | undefined): string {
	if (value == null || value.startsWith("--")) {
		console.error(`${flag} requires a value`);
		process.exit(1);
	}
	return value;
}

function positiveInt(flag: string, value: string): number {
	const parsed = Number.parseInt(value, 10);
	if (!Number.isInteger(parsed) || parsed < 1) {
		console.error(`${flag} must be a positive integer`);
		process.exit(1);
	}
	return parsed;
}

function printHelp() {
	console.log(`Usage: bun benchmark/polyglot/octofwen-polyglot.ts [options]

Options:
  --benchmarks-dir <path>       Directory for benchmark run outputs
  --config <path>               Octofwen config path
  --dry-run                     Print selected exercises without LLM/tool execution
  --exercises-dir <path>        Aider-AI/polyglot-benchmark checkout
  --keywords <text[,text]>      Keep exercises whose relative path contains any keyword
  --languages <lang[,lang]>     Keep language directories, e.g. rust,go
  --max-tool-iterations <n>     Tool-call loop limit per model turn
  --model <nickname>            Octofwen model nickname
  --name <name>                 Run name suffix
  --num-tests <n>               Limit selected exercises after filtering
  --purge-exercises-dir-before-run
                               Delete source checkout after in-memory snapshot
  --request-timeout-ms <n>      Per agent/tool request timeout in milliseconds
  --test-timeout-ms <n>         Per-test command timeout in milliseconds
  --tries <n>                   Agent/test attempts per exercise
`);
}

async function selectExercises(options: Args): Promise<Exercise[]> {
	const languageFilter = csvSet(options.languages);
	const keywordFilter = csvList(options.keywords);
	const languageDirs = await readdir(options.exercisesDir, {
		withFileTypes: true,
	});
	const exercises: Exercise[] = [];
	for (const languageDir of languageDirs) {
		if (!languageDir.isDirectory()) continue;
		const language = languageDir.name;
		if (languageFilter && !languageFilter.has(language.toLowerCase())) continue;
		const practiceDir = path.join(
			options.exercisesDir,
			language,
			"exercises",
			"practice",
		);
		let entries;
		try {
			entries = await readdir(practiceDir, { withFileTypes: true });
		} catch {
			continue;
		}
		for (const entry of entries) {
			if (!entry.isDirectory()) continue;
			const relativePath = path.join(
				language,
				"exercises",
				"practice",
				entry.name,
			);
			if (
				keywordFilter &&
				!keywordFilter.some((keyword) => relativePath.includes(keyword))
			)
				continue;
			exercises.push({
				language,
				name: entry.name,
				relativePath,
				sourcePath: path.join(practiceDir, entry.name),
			});
		}
	}
	exercises.sort((left, right) =>
		left.relativePath.localeCompare(right.relativePath),
	);
	if (options.numTests > 0) return exercises.slice(0, options.numTests);
	return exercises;
}

function csvSet(value: string | undefined): Set<string> | null {
	const list = csvList(value);
	return list ? new Set(list.map((entry) => entry.toLowerCase())) : null;
}

function csvList(value: string | undefined): string[] | null {
	if (!value) return null;
	const list = value
		.split(",")
		.map((entry) => entry.trim())
		.filter(Boolean);
	return list.length > 0 ? list : null;
}

async function snapshotExercises(exercises: Exercise[]): Promise<void> {
	for (const exercise of exercises) {
		exercise.files = await snapshotDirectory(exercise.sourcePath);
	}
}

async function snapshotDirectory(root: string): Promise<SnapshotFile[]> {
	const files: SnapshotFile[] = [];
	await collectSnapshotFiles(root, "", files);
	return files;
}

async function collectSnapshotFiles(
	root: string,
	relativeRoot: string,
	files: SnapshotFile[],
): Promise<void> {
	for (const entry of await readdir(path.join(root, relativeRoot), {
		withFileTypes: true,
	})) {
		const relativePath = path.join(relativeRoot, entry.name);
		if (entry.isDirectory()) {
			await collectSnapshotFiles(root, relativePath, files);
		} else if (entry.isFile()) {
			files.push({
				relativePath,
				contents: await readFile(path.join(root, relativePath)),
			});
		}
	}
}

async function writeSnapshot(
	destination: string,
	files: readonly SnapshotFile[],
): Promise<void> {
	await rm(destination, { recursive: true, force: true });
	await mkdir(destination, { recursive: true });
	for (const file of files) {
		const filePath = path.join(destination, file.relativePath);
		await mkdir(path.dirname(filePath), { recursive: true });
		await writeFile(filePath, file.contents);
	}
}

function snapshotFiles(exercise: Exercise): readonly SnapshotFile[] | null {
	return exercise.files ?? null;
}

async function createRunDir(
	benchmarksDir: string,
	name: string,
): Promise<string> {
	const stamp = new Date()
		.toISOString()
		.replace(/[:T]/gu, "-")
		.replace(/\.\d{3}Z$/u, "");
	const runDir = path.join(benchmarksDir, `${stamp}--${name}`);
	await mkdir(runDir, { recursive: true });
	return runDir;
}

function exerciseFileSets(
	filesSnapshot: readonly SnapshotFile[],
): ExerciseFileSets | null {
	const configFile = filesSnapshot.find(
		(file) => file.relativePath === path.join(".meta", "config.json"),
	);
	if (!configFile) return null;
	const raw = JSON.parse(new TextDecoder().decode(configFile.contents)) as {
		files?: Record<string, string[]>;
	};
	const files = raw.files ?? {};
	return {
		solutionFiles: files["solution"] ?? [],
		testFiles: files["test"] ?? [],
		exampleFiles: files["example"] ?? [],
		invalidatorFiles: files["invalidator"] ?? [],
	};
}

async function hideNonSolutionFiles(
	workDir: string,
	fileSets: ExerciseFileSets,
): Promise<void> {
	const hidden = new Set([
		...fileSets.testFiles,
		...fileSets.exampleFiles,
		...fileSets.invalidatorFiles,
	]);
	for (const file of hidden)
		await rm(path.join(workDir, file), { force: true });
	await rm(path.join(workDir, ".meta"), { recursive: true, force: true });
	await rm(path.join(workDir, ".approaches"), { recursive: true, force: true });
	await rm(path.join(workDir, ".articles"), { recursive: true, force: true });
}

async function prepareScoringDirectory(
	filesSnapshot: readonly SnapshotFile[],
	workDir: string,
	caseDir: string,
	fileSets: ExerciseFileSets,
): Promise<void> {
	await writeSnapshot(caseDir, filesSnapshot);
	for (const solutionFile of fileSets.solutionFiles) {
		const source = path.join(workDir, solutionFile);
		const destination = path.join(caseDir, solutionFile);
		await mkdir(path.dirname(destination), { recursive: true });
		await cp(source, destination, { recursive: true });
	}
}

async function prepareLanguageTests(
	language: string,
	cwd: string,
	testFiles: string[],
): Promise<void> {
	if (language !== "java") return;
	for (const testFile of testFiles.filter((file) => file.endsWith(".java"))) {
		const filePath = path.join(cwd, testFile);
		const content = await readFile(filePath, "utf8");
		await writeFile(
			filePath,
			content.replaceAll(/@Disabled\([^)]*\)\s*\n/gu, ""),
		);
	}
}

async function runExerciseSafely(params: {
	apiKey: string;
	args: Args;
	bridge: AgentdRustBridge;
	config: Config;
	exercise: Exercise;
	model: ModelConfig;
	runDir: string;
}): Promise<CaseResult> {
	try {
		return await runExercise(params);
	} catch (error) {
		const message =
			error instanceof Error ? error.stack || error.message : String(error);
		return {
			testcase: params.exercise.relativePath,
			language: params.exercise.language,
			model: params.model.model,
			tries: params.args.tries,
			tests_outcomes: [false],
			test_outputs: [message],
			duration: 0,
			command: `octofwen polyglot ${params.model.nickname}`,
		};
	}
}


function failedCaseResult(
	exercise: Exercise,
	model: ModelConfig,
	tries: number,
	message: string,
): CaseResult {
	return {
		testcase: exercise.relativePath,
		language: exercise.language,
		model: model.model,
		tries,
		tests_outcomes: [false],
		test_outputs: [message],
		duration: 0,
		command: `octofwen polyglot ${model.nickname}`,
	};
}

async function runExercise({
	apiKey,
	args,
	bridge,
	config,
	exercise,
	model,
	runDir,
}: {
	apiKey: string;
	args: Args;
	bridge: AgentdRustBridge;
	config: Config;
	exercise: Exercise;
	model: ModelConfig;
	runDir: string;
}): Promise<CaseResult> {
	const filesSnapshot = snapshotFiles(exercise);
	if (!filesSnapshot) {
		return failedCaseResult(
			exercise,
			model,
			args.tries,
			`Exercise ${exercise.relativePath} was not snapshotted`,
		);
	}
	const fileSets = exerciseFileSets(filesSnapshot);
	if (!fileSets) {
		return failedCaseResult(
			exercise,
			model,
			args.tries,
			"Exercise snapshot has no .meta/config.json",
		);
	}
	const caseDir = path.join(runDir, exercise.relativePath);
	const workDir = path.join(runDir, ".work", exercise.relativePath);
	await mkdir(path.dirname(caseDir), { recursive: true });
	await mkdir(path.dirname(workDir), { recursive: true });
	await writeSnapshot(workDir, filesSnapshot);
	await hideNonSolutionFiles(workDir, fileSets);
	const start = performance.now();
	const testsOutcomes: boolean[] = [];
	const testOutputs: string[] = [];
	let messages: unknown[] = [
		{
			role: "user",
			content: [
				{
					type: "text",
					content: await exercisePrompt(exercise, filesSnapshot, workDir),
				},
			],
		},
	];
	for (let attempt = 0; attempt < args.tries; attempt += 1) {
		messages = await runAgentTurn({
			apiKey,
			args,
			bridge,
			caseDir: workDir,
			config,
			messages,
			model,
		});
		await prepareScoringDirectory(
			filesSnapshot,
			workDir,
			caseDir,
			fileSets,
		);
		const testResult = await runTests(
			exercise.language,
			caseDir,
			args.testTimeoutMs,
			fileSets.testFiles,
		);
		testsOutcomes.push(testResult.ok);
		testOutputs.push(testResult.output);
		if (testResult.ok) break;
		if (attempt + 1 < args.tries) {
			await rm(caseDir, { recursive: true, force: true });
		}
		messages.push({
			role: "user",
			content: [{ type: "text", content: retryPrompt(testResult.output) }],
		});
	}
	const result: CaseResult = {
		testcase: exercise.relativePath,
		language: exercise.language,
		model: model.model,
		tries: args.tries,
		tests_outcomes: testsOutcomes,
		test_outputs: testOutputs,
		duration: (performance.now() - start) / 1000,
		command: `octofwen polyglot ${model.nickname}`,
	};
	await writeFile(
		path.join(caseDir, ".octofwen.results.json"),
		JSON.stringify(result, null, 2),
	);
	return result;
}

async function exercisePrompt(
	exercise: Exercise,
	filesSnapshot: readonly SnapshotFile[],
	workDir: string,
): Promise<string> {
	const instructions = exerciseDocs(filesSnapshot);
	return `You are solving an Exercism benchmark exercise for the Aider Polyglot benchmark, using Octofwen tools.

Exercise: ${exercise.relativePath}
Working directory: ${workDir}
Harness test command: ${testCommand(exercise.language)}

Instructions:
${instructions || `Implement the ${exercise.name} exercise.`}

Edit the visible exercise implementation files until the harness tests pass. Test files, example solutions, and metadata are not available in the working directory; the harness restores original tests in a separate scoring directory after each attempt. Do not ask the user questions.`;
}

function exerciseDocs(filesSnapshot: readonly SnapshotFile[]): string {
	const decoder = new TextDecoder();
	return [
		path.join(".docs", "introduction.md"),
		path.join(".docs", "instructions.md"),
		path.join(".docs", "instructions.append.md"),
	]
		.map((docPath) =>
			filesSnapshot.find((file) => file.relativePath === docPath),
		)
		.filter((file): file is SnapshotFile => file != null)
		.map((file) => decoder.decode(file.contents).trim())
		.filter(Boolean)
		.join("\n\n");
}

function retryPrompt(output: string): string {
	return `The tests failed. Fix the exercise and run the tests again. Test output:

${truncate(output, 12_000)}`;
}

async function runAgentTurn({
	apiKey,
	args,
	bridge,
	caseDir,
	config,
	messages,
	model,
}: {
	apiKey: string;
	args: Args;
	bridge: AgentdRustBridge;
	caseDir: string;
	config: Config;
	messages: unknown[];
	model: ModelConfig;
}): Promise<unknown[]> {
	const { LocalTransport } = await import(
		"../../packages/octofwen-cli/src/transport/local.ts"
	);
	const transport = new LocalTransport(caseDir);
	try {
		let currentMessages = messages;
		for (
			let iteration = 0;
			iteration < args.maxToolIterations;
			iteration += 1
		) {
			const finish = await withAbortTimeout(
				args.requestTimeoutMs,
				(abortSignal) =>
					bridge.trajectoryArc(
						{
							cwd: caseDir,
							apiKey,
							model: {
								type: model.type,
								baseUrl: model.baseUrl,
								model: model.model,
								context: model.context,
								reasoning: model.reasoning,
								thinkingBudgetTokens: model.thinkingBudgetTokens,
								modalities: model.modalities,
							},
							messages: currentMessages,
							config: trajectoryConfig(config),
						},
						{ abortSignal, cancelOnAbort: true },
					),
			);
			currentMessages = finish.irs;
			if (finish.reason.type === "needs-response") return currentMessages;
			if (finish.reason.type !== "request-tool") {
				currentMessages.push({
					role: "user",
					content: [
						{
							type: "text",
							content: `Octofwen stopped with ${finish.reason.type}. Continue if possible, otherwise explain the blocker precisely.`,
						},
					],
				});
				continue;
			}
			for (const rawCall of finish.reason.toolCalls) {
				const call = asToolCall(rawCall);
				if (!call) continue;
				currentMessages.push(
					await runToolCall({
						bridge,
						call,
						config,
						model,
						transport,
						timeoutMs: args.requestTimeoutMs,
					}),
				);
			}
		}
		currentMessages.push({
			role: "user",
			content: [
				{
					type: "text",
					content:
						"Tool loop limit reached. Stop and summarize the exact blocker.",
				},
			],
		});
		return currentMessages;
	} finally {
		await transport.close();
	}
}

function trajectoryConfig(
	config: Config,
): Parameters<AgentdRustBridge["trajectoryArc"]>[0]["config"] {
	return {
		yourName: config.yourName,
		mcpServers: config.mcpServers,
		search: config.search,
		skills: config.skills,
		defaultApiKeyOverrides: config.defaultApiKeyOverrides,
		authModels: [
			...config.models,
			...(config.diffApply ? [config.diffApply] : []),
			...(config.fixJson ? [config.fixJson] : []),
		].map((entry) => ({
			baseUrl: entry.baseUrl,
			apiEnvVar: entry.apiEnvVar,
			auth: entry.auth,
		})),
		fixJson: config.fixJson
			? {
					baseUrl: config.fixJson.baseUrl,
					apiEnvVar: config.fixJson.apiEnvVar,
					auth: config.fixJson.auth,
					model: config.fixJson.model,
				}
			: undefined,
	};
}

function asToolCall(value: unknown): ToolCall | null {
	if (typeof value !== "object" || value === null || Array.isArray(value))
		return null;
	const record = value as Record<string, unknown>;
	if (record["type"] !== "tool-call") return null;
	if (typeof record["name"] !== "string") return null;
	if (typeof record["toolCallId"] !== "string") return null;
	if (
		typeof record["parsed"] !== "object" ||
		record["parsed"] === null ||
		Array.isArray(record["parsed"])
	)
		return null;
	return record as ToolCall;
}

async function runToolCall({
	bridge,
	call,
	config,
	model,
	timeoutMs,
	transport,
}: {
	bridge: AgentdRustBridge;
	call: ToolCall;
	config: Config;
	model: ModelConfig;
	timeoutMs: number;
	transport: Transport;
}): Promise<unknown> {
	const parsed = await preflightParsed(call, transport);
	const result = await withAbortTimeout(timeoutMs, (abortSignal) =>
		bridge.toolRun(
			{
				toolName: call.name,
				cwd: transport.cwd,
				transport: transport.toolRunTransport?.(),
				toolCallId: call.toolCallId,
				toolCall: { ...call, parsed },
				parsed,
				modelContext: model.context,
				mcpServers: config.mcpServers ?? null,
				lsp: config.lsp ?? null,
				userName: config.yourName,
			},
			{ abortSignal, cancelOnAbort: true },
		),
	);
	if (result.status === "error") {
		return {
			role: "tool-runtime-error",
			toolCall: call,
			error: result.message,
		};
	}
	if (result.result.type === "custom-ir") return result.result.data;
	if (result.result.type === "invoke-subagent") {
		return {
			role: "tool-runtime-error",
			toolCall: call,
			error: `Subagent invocation is not supported in the polyglot benchmark: ${result.result.name}`,
		};
	}
	return {
		role: "tool-output",
		toolCall: call,
		content: result.result.content,
	};
}

async function preflightParsed(
	call: ToolCall,
	transport: Transport,
): Promise<Record<string, unknown>> {
	if (call.name !== "edit" && call.name !== "rewrite") return call.parsed;
	const filePath = call.parsed["filePath"];
	if (typeof filePath !== "string") return call.parsed;
	const parsed = { ...call.parsed };
	delete parsed["originalFileContents"];
	try {
		parsed["originalFileContents"] = await transport.readFile(
			new AbortController().signal,
			filePath,
		);
	} catch {
		delete parsed["originalFileContents"];
	}
	return parsed;
}

async function withAbortTimeout<T>(
	timeoutMs: number,
	run: (abortSignal: AbortSignal) => Promise<T>,
): Promise<T> {
	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), timeoutMs);
	try {
		return await run(controller.signal);
	} finally {
		clearTimeout(timer);
	}
}

async function runTests(
	language: string,
	cwd: string,
	timeoutMs: number,
	testFiles: string[],
): Promise<RunResult> {
	await prepareLanguageTests(language, cwd, testFiles);
	const command = testCommand(language);
	const start = performance.now();
	const proc = Bun.spawn(["/bin/sh", "-lc", command], {
		cwd,
		stdout: "pipe",
		stderr: "pipe",
	});
	let timedOut = false;
	const timer = setTimeout(() => {
		timedOut = true;
		proc.kill();
	}, timeoutMs);
	try {
		const [stdout, stderr, exitCode] = await Promise.all([
			new Response(proc.stdout).text(),
			new Response(proc.stderr).text(),
			proc.exited,
		]);
		const timeoutText = timedOut
			? `\n[command timed out after ${timeoutMs} ms]`
			: "";
		return {
			command,
			durationMs: performance.now() - start,
			ok: !timedOut && exitCode === 0,
			output: truncate(`${stdout}${stderr}${timeoutText}`, 40_000),
		};
	} finally {
		clearTimeout(timer);
	}
}

function testCommand(language: string): string {
	switch (language) {
		case "cpp":
			return "mkdir -p build && cd build && cmake -DEXERCISM_RUN_ALL_TESTS=1 -G 'Unix Makefiles' .. && make";
		case "go":
			return "go test ./...";
		case "java":
			return "./gradlew test";
		case "javascript":
			return "[ -e node_modules ] || ln -s /npm-install/node_modules node_modules; [ -e package-lock.json ] || ln -s /npm-install/package-lock.json package-lock.json; sed -i 's/\\bxtest(/test(/g' *.spec.js; npm run test";
		case "python":
			return "python3 -m pytest -q";
		case "rust":
			return "cargo test --quiet -- --include-ignored";
		default:
			return "false";
	}
}

function truncate(value: string, max: number): string {
	if (value.length <= max) return value;
	return `${value.slice(0, max)}\n[truncated ${value.length - max} bytes]`;
}

function reportProgress(results: CaseResult[], total: number): void {
	const passed = results.filter((result) =>
		result.tests_outcomes.some(Boolean),
	).length;
	console.log(
		`Completed ${results.length}/${total}; passed ${passed}/${results.length}`,
	);
}
