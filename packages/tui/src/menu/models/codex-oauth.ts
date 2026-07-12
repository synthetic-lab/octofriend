import { mkdir, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

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
		try {
			return JSON.stringify(value);
		} catch {
			return "OAuth request failed";
		}
	}
	return String(value);
}

async function jsonRequest(
	url: string,
	init: RequestInit,
): Promise<Record<string, unknown>> {
	const response = await fetch(url, init);
	const text = await response.text();
	let body: unknown;
	try {
		body = JSON.parse(text);
	} catch {
		throw new Error(`OAuth returned invalid JSON (${response.status})`);
	}
	if (!response.ok) {
		const error =
			typeof body === "object" && body !== null && "error" in body
				? (body as Record<string, unknown>).error
				: `OAuth request failed (${response.status})`;
		throw new Error(formatCodexOAuthError(error));
	}
	if (typeof body !== "object" || body === null)
		throw new Error("OAuth returned an invalid response");
	return body as Record<string, unknown>;
}

function openBrowser(url: string): void {
	const command =
		process.platform === "darwin"
			? "open"
			: process.platform === "win32"
				? "cmd"
				: "xdg-open";
	const args = process.platform === "win32" ? ["/c", "start", "", url] : [url];
	Bun.spawn([command, ...args], {
		stdin: "ignore",
		stdout: "ignore",
		stderr: "ignore",
	});
}

export type CodexIdTokenClaims = {
	chatgpt_account_id?: string;
	organizations?: Array<{ id: string }>;
	"https://api.openai.com/auth"?: {
		chatgpt_account_id?: string;
	};
};

export function parseCodexJwtClaims(
	token: string,
): CodexIdTokenClaims | undefined {
	const parts = token.split(".");
	if (parts.length !== 3 || !parts[1]) return undefined;
	try {
		return JSON.parse(
			Buffer.from(parts[1], "base64url").toString(),
		) as CodexIdTokenClaims;
	} catch {
		return undefined;
	}
}

export function extractCodexAccountId(
	claims: CodexIdTokenClaims,
): string | undefined {
	return (
		claims.chatgpt_account_id ??
		claims["https://api.openai.com/auth"]?.chatgpt_account_id ??
		claims.organizations?.[0]?.id
	);
}

function accountIdFromTokenResponse(
	token: Record<string, unknown>,
): string | undefined {
	if (typeof token.account_id === "string") return token.account_id;
	for (const field of ["id_token", "access_token"]) {
		const value = token[field];
		if (typeof value !== "string") continue;
		const claims = parseCodexJwtClaims(value);
		if (!claims) continue;
		const accountId = extractCodexAccountId(claims);
		if (accountId) return accountId;
	}
	return undefined;
}

async function writeTokens(tokens: Record<string, unknown>): Promise<void> {
	const path = join(homedir(), ".config", "octofriend", "oauth.json");
	await mkdir(dirname(path), { recursive: true });
	await writeFile(path, `$${JSON.stringify({ codex: tokens }, null, 2)}\n`, {
		encoding: "utf8",
		mode: 0o600,
	});
}

type DeviceAuthorization = {
	deviceAuthId: string;
	userCode: string;
	interval: number;
};

async function requestDeviceAuthorization(): Promise<DeviceAuthorization> {
	const device = await jsonRequest(
		`${ISSUER}/api/accounts/deviceauth/usercode`,
		{
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				"User-Agent": "octofriend",
			},
			body: JSON.stringify({ client_id: CLIENT_ID }),
		},
	);
	const deviceAuthId = String(device.device_auth_id ?? "");
	const userCode = String(device.user_code ?? "");
	if (!(deviceAuthId && userCode)) {
		throw new Error("OAuth did not return a device code");
	}
	return {
		deviceAuthId,
		userCode,
		interval: Math.max(Number(device.interval ?? 5), 1) * 1000,
	};
}

async function pollDeviceAuthorization(
	device: DeviceAuthorization,
	signal: AbortSignal,
): Promise<{ authorizationCode: string; codeVerifier: string } | null> {
	const response = await fetch(`${ISSUER}/api/accounts/deviceauth/token`, {
		method: "POST",
		headers: {
			"Content-Type": "application/json",
			"User-Agent": "octofriend",
		},
		body: JSON.stringify({
			device_auth_id: device.deviceAuthId,
			user_code: device.userCode,
		}),
		signal,
	});
	if (response.status === 403 || response.status === 404) return null;
	if (!response.ok)
		throw new Error(`OAuth polling failed (${response.status})`);
	const pending = (await response.json()) as Record<string, unknown>;
	const authorizationCode = String(pending.authorization_code ?? "");
	const codeVerifier = String(pending.code_verifier ?? "");
	return authorizationCode && codeVerifier
		? { authorizationCode, codeVerifier }
		: null;
}

async function exchangeAuthorizationCode(
	authorizationCode: string,
	codeVerifier: string,
): Promise<void> {
	const token = await jsonRequest(`${ISSUER}/oauth/token`, {
		method: "POST",
		headers: { "Content-Type": "application/x-www-form-urlencoded" },
		body: new URLSearchParams({
			grant_type: "authorization_code",
			code: authorizationCode,
			redirect_uri: REDIRECT_URI,
			client_id: CLIENT_ID,
			code_verifier: codeVerifier,
		}).toString(),
	});
	await writeTokens({
		access: token.access_token,
		refresh: token.refresh_token,
		expires: Date.now() + Number(token.expires_in ?? 3600) * 1000,
		accountId: accountIdFromTokenResponse(token),
	});
}

export async function authorizeCodexOAuth(
	onStatus: (status: CodexOAuthStatus) => void,
	signal: AbortSignal,
): Promise<void> {
	const device = await requestDeviceAuthorization();
	const url = `${ISSUER}/codex/device`;
	onStatus({ type: "waiting", url, code: device.userCode });
	try {
		openBrowser(url);
	} catch {
		// The manual URL remains visible when browser launch fails.
	}

	while (!signal.aborted) {
		await Bun.sleep(device.interval);
		if (signal.aborted) break;
		const authorization = await pollDeviceAuthorization(device, signal);
		if (!authorization) continue;
		await exchangeAuthorizationCode(
			authorization.authorizationCode,
			authorization.codeVerifier,
		);
		return;
	}
	throw new Error("OAuth authorization cancelled");
}
