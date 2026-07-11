import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { homedir } from "node:os";

const CLIENT_ID = "app_EMoamEEZ73f0CkXaXp7hrann";
const ISSUER = "https://auth.openai.com";
const REDIRECT_URI = `${ISSUER}/deviceauth/callback`;

export type CodexOAuthStatus =
	| { type: "starting" }
	| { type: "waiting"; url: string; code: string }
	| { type: "error"; message: string };

export function formatCodexOAuthError(value: unknown): string {
	if (typeof value === "string") return value;
	if (value && typeof value === "object") {
		const record = value as Record<string, unknown>;
		for (const key of ["message", "error_description", "error", "detail"]) {
			if (key in record) return formatCodexOAuthError(record[key]);
		}
		try { return JSON.stringify(value); } catch { return "OAuth request failed"; }
	}
	return String(value);
}

async function jsonRequest(url: string, init: RequestInit): Promise<Record<string, unknown>> {
	const response = await fetch(url, init);
	const text = await response.text();
	let body: unknown;
	try { body = JSON.parse(text); } catch { throw new Error(`OAuth returned invalid JSON (${response.status})`); }
	if (!response.ok) {
		const error = typeof body === "object" && body !== null && "error" in body
			? (body as Record<string, unknown>).error
			: `OAuth request failed (${response.status})`;
		throw new Error(formatCodexOAuthError(error));
	}
	if (typeof body !== "object" || body === null) throw new Error("OAuth returned an invalid response");
	return body as Record<string, unknown>;
}

function openBrowser(url: string): void {
	const command = process.platform === "darwin" ? "open" : process.platform === "win32" ? "cmd" : "xdg-open";
	const args = process.platform === "win32" ? ["/c", "start", "", url] : [url];
	Bun.spawn([command, ...args], { stdin: "ignore", stdout: "ignore", stderr: "ignore" });
}

async function writeTokens(tokens: Record<string, unknown>): Promise<void> {
	const path = join(homedir(), ".config", "octofriend", "oauth.json");
	await mkdir(dirname(path), { recursive: true });
	await writeFile(path, `${JSON.stringify({ codex: tokens }, null, 2)}\n`, "utf8");
}

export async function authorizeCodexOAuth(
	onStatus: (status: CodexOAuthStatus) => void,
	signal: AbortSignal,
): Promise<void> {
	const device = await jsonRequest(`${ISSUER}/api/accounts/deviceauth/usercode`, {
		method: "POST",
		headers: { "Content-Type": "application/json", "User-Agent": "octofriend" },
		body: JSON.stringify({ client_id: CLIENT_ID }),
	});
	const deviceAuthId = String(device.device_auth_id ?? "");
	const userCode = String(device.user_code ?? "");
	if (!deviceAuthId || !userCode) throw new Error("OAuth did not return a device code");
	const interval = Math.max(Number(device.interval ?? 5), 1) * 1000;
	const url = `${ISSUER}/codex/device`;
	onStatus({ type: "waiting", url, code: userCode });
	try { openBrowser(url); } catch { /* manual URL remains visible */ }

	while (!signal.aborted) {
		await Bun.sleep(interval);
		if (signal.aborted) throw new Error("OAuth authorization cancelled");
		const response = await fetch(`${ISSUER}/api/accounts/deviceauth/token`, {
			method: "POST", headers: { "Content-Type": "application/json", "User-Agent": "octofriend" },
			body: JSON.stringify({ device_auth_id: deviceAuthId, user_code: userCode }), signal,
		});
		if (response.status === 403 || response.status === 404) continue;
		if (!response.ok) throw new Error(`OAuth polling failed (${response.status})`);
		const pending = await response.json() as Record<string, unknown>;
		const authorizationCode = String(pending.authorization_code ?? "");
		const codeVerifier = String(pending.code_verifier ?? "");
		if (!authorizationCode || !codeVerifier) continue;
		const token = await jsonRequest(`${ISSUER}/oauth/token`, {
			method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
			body: new URLSearchParams({
				grant_type: "authorization_code",
				code: authorizationCode,
				redirect_uri: REDIRECT_URI,
				client_id: CLIENT_ID,
				code_verifier: codeVerifier,
			}).toString(),
		});
		await writeTokens({
			access: token.access_token, refresh: token.refresh_token,
			expires: Date.now() + Number(token.expires_in ?? 3600) * 1000,
			accountId: typeof token.account_id === "string" ? token.account_id : undefined,
		});
		return;
	}
	throw new Error("OAuth authorization cancelled");
}
