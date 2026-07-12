import { createAgentdRustBridge } from "./bridge/agent/agent.ts";
import { assertKeyForModel } from "./config/keys.ts";
import type { Config } from "./config/schemas.ts";
import { exitForMissingModel, selectModel } from "./model-selection.ts";
import {
	replayProviderTokenEvents,
	runCliProviderCompletion,
} from "./run-provider.ts";
import type { Transport } from "./workspace/common.ts";

type SuccessfulBenchmark = {
	tokens: number;
	requestElapsed: number;
	success: true;
};

type FailedBenchmark = {
	success: false;
	error: string;
};

type BenchmarkResult = SuccessfulBenchmark | FailedBenchmark;

export type BenchmarkOptions = {
	model?: string;
	prompt?: string;
	concurrency?: string;
};

function parseConcurrency(value?: string): number {
	return Math.max(1, Number.parseInt(value ?? "1", 10));
}

async function runSingleBenchmark({
	apiKey,
	model,
	prompt,
	cwd,
}: {
	apiKey: string;
	model: Config["models"][number];
	prompt?: string;
	cwd: string;
}): Promise<BenchmarkResult> {
	const start = new Date();
	const bridge = await createAgentdRustBridge();
	try {
		const result = await runCliProviderCompletion({
			bridge,
			apiKey,
			model,
			cwd,
			messages: [
				{
					role: "user",
					content: [
						{
							type: "text",
							content:
								prompt ??
								"Write me a short story about a frog going to the moon. Do not use ANY tools.",
						},
					],
				},
			],
		});
		if (!result.success) return { success: false, error: result.error };
		let sawToken = false;
		replayProviderTokenEvents(result.data, () => {
			sawToken = true;
		});

		const end = new Date();
		if (!sawToken) return { success: false, error: "No tokens received" };

		const tokens = result.data.usage.output;
		const requestElapsed = end.getTime() - start.getTime();
		return { tokens, requestElapsed, success: true };
	} catch (error) {
		return {
			success: false,
			error: error instanceof Error ? error.message : String(error),
		};
	} finally {
		bridge.close();
	}
}

function reportFailures(failures: FailedBenchmark[], concurrency: number) {
	if (failures.length === 0) return;
	console.error(`\n${failures.length} request(s) failed:`);
	for (const failure of failures) console.error(`  - ${failure.error}`);
	if (failures.length === concurrency) process.exit(1);
}

function reportSuccesses({
	successes,
	concurrency,
	benchmarkStart,
	benchmarkEnd,
}: {
	successes: SuccessfulBenchmark[];
	concurrency: number;
	benchmarkStart: Date;
	benchmarkEnd: Date;
}) {
	if (successes.length === 0) {
		console.log("No successful requests");
		process.exit(1);
	}

	const totalTokens = successes.reduce((sum, result) => sum + result.tokens, 0);
	const avgTokens = totalTokens / successes.length;
	const avgRequestElapsed =
		successes.reduce((sum, result) => sum + result.requestElapsed, 0) /
		successes.length;
	const totalTime = (benchmarkEnd.getTime() - benchmarkStart.getTime()) / 1000;
	const tps = totalTokens / totalTime;

	console.log(`\n
Successful requests: ${successes.length}/${concurrency}
Total tokens: ${totalTokens}
Avg tokens per request: ${avgTokens.toFixed(2)}
Total time: ${totalTime.toFixed(2)}s
Avg request time: ${(avgRequestElapsed / 1000).toFixed(3)}s
`);

	const perRequestTps =
		successes
			.map((result) => result.tokens / (result.requestElapsed / 1000))
			.reduce((a, b) => a + b, 0) / successes.length;
	console.log(`Tok/sec output (overall): ${tps.toFixed(2)}
Tok/sec output (per-request avg): ${perRequestTps}
`);
}

export async function runBenchmarkCommand(
	config: Config,
	transport: Transport,
	opts: BenchmarkOptions,
) {
	const model = selectModel(config, opts.model);
	if (model == null) exitForMissingModel(config.models, opts.model);

	const concurrency = parseConcurrency(opts.concurrency);
	const apiKey = await assertKeyForModel(model, config);
	console.log(
		`Benchmarking ${model.nickname} with ${concurrency} concurrent request${concurrency > 1 ? "s" : ""}`,
	);

	const timer = setInterval(() => {
		console.log("Still working...");
	}, 5000);
	const benchmarkStart = new Date();
	let results: BenchmarkResult[];
	let benchmarkEnd: Date;
	try {
		results = await Promise.all(
			Array.from({ length: concurrency }, () =>
				runSingleBenchmark({
					apiKey,
					model,
					prompt: opts.prompt,
					cwd: transport.cwd,
				}),
			),
		);
		benchmarkEnd = new Date();
	} finally {
		clearInterval(timer);
	}

	reportFailures(
		results.filter((result): result is FailedBenchmark => !result.success),
		concurrency,
	);
	reportSuccesses({
		successes: results.filter(
			(result): result is SuccessfulBenchmark => result.success,
		),
		concurrency,
		benchmarkStart,
		benchmarkEnd,
	});
}
