import { resolveAgentdCommand } from "./command";
import { firstNonEmptyStdoutLine } from "./stdout";

let nextRequestId = 1;

export async function agentdTransportRequestRaw(
	signal: AbortSignal,
	method: string,
	params: Record<string, unknown>,
): Promise<unknown> {
	if (signal.aborted)
		return Promise.reject(new Error("agentd request aborted"));
	const subprocess = Bun.spawn(resolveAgentdCommand(), {
		stdin: "pipe",
		stdout: "pipe",
		stderr: "pipe",
		env: process.env,
	});
	let aborted = false;
	const onAbort = () => {
		aborted = true;
		subprocess.kill();
	};
	signal.addEventListener("abort", onAbort, { once: true });
	try {
		const id = nextRequestId++;
		subprocess.stdin.write(
			`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`,
		);
		subprocess.stdin.flush();
		subprocess.stdin.end();
		const [stdout, stderr] = await Promise.all([
			new Response(subprocess.stdout).text(),
			new Response(subprocess.stderr).text(),
		]);
		const exitCode = await subprocess.exited;
		if (aborted) return Promise.reject(new Error("agentd request aborted"));
		if (exitCode !== 0) {
			return Promise.reject(
				new Error(`octofwen-agentd exited with code ${exitCode}: ${stderr}`),
			);
		}
		const firstLine = firstNonEmptyStdoutLine(stdout);
		if (!firstLine) {
			return Promise.reject(new Error("octofwen-agentd returned no response"));
		}
		const response = JSON.parse(firstLine) as {
			result?: unknown;
			error?: { message?: string; data?: unknown };
		};
		if (response.error) {
			const error = new Error(
				response.error.message ?? "octofwen-agentd request failed",
			);
			(error as Error & { data?: unknown }).data = response.error.data;
			return Promise.reject(error);
		}
		return response.result;
	} finally {
		signal.removeEventListener("abort", onAbort);
	}
}
