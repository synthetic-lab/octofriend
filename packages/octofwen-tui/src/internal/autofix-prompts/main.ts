type DiffEdit = {
	search: string;
	replace: string;
};

export type DiffApplySuccessResponse = {
	success: true;
	search: string;
};
export type DiffApplyFailureResponse = {
	success: false;
};
export type DiffApplyResponseValue =
	| DiffApplySuccessResponse
	| DiffApplyFailureResponse;

export type JsonFixSuccessResponse = {
	success: true;
	fixed: unknown;
};
export type JsonFixFailureResponse = {
	success: false;
};
export type JsonFixResponse = JsonFixSuccessResponse | JsonFixFailureResponse;

type ResponseSchema<T> = {
	name: string;
	typeScript: string;
	slice(value: unknown): T;
	or<Other>(other: ResponseSchema<Other>): ResponseSchema<T | Other>;
};

class LiteralResponseSchema<T> implements ResponseSchema<T> {
	readonly name: string;
	readonly typeScript: string;
	readonly #parse: (value: unknown) => T;

	constructor(name: string, typeScript: string, parse: (value: unknown) => T) {
		this.name = name;
		this.typeScript = typeScript;
		this.#parse = parse;
	}

	slice(value: unknown): T {
		return this.#parse(value);
	}

	or<Other>(other: ResponseSchema<Other>): ResponseSchema<T | Other> {
		return new UnionResponseSchema(this, other);
	}
}

class UnionResponseSchema<A, B> implements ResponseSchema<A | B> {
	readonly name: string;
	readonly typeScript: string;
	readonly #left: ResponseSchema<A>;
	readonly #right: ResponseSchema<B>;

	constructor(left: ResponseSchema<A>, right: ResponseSchema<B>) {
		this.#left = left;
		this.#right = right;
		this.name = `${left.name} | ${right.name}`;
		this.typeScript = `${left.typeScript}
${right.typeScript}`;
	}

	slice(value: unknown): A | B {
		try {
			return this.#left.slice(value);
		} catch {
			return this.#right.slice(value);
		}
	}

	or<Other>(other: ResponseSchema<Other>): ResponseSchema<A | B | Other> {
		return new UnionResponseSchema(this, other);
	}
}

function asRecord(value: unknown): Record<string, unknown> {
	if (typeof value === "object" && value !== null && !Array.isArray(value)) {
		return value as Record<string, unknown>;
	}
	throw new Error("Expected object");
}

function assertExactKeys(
	record: Record<string, unknown>,
	allowed: readonly string[],
	schemaName: string,
): void {
	const allowedKeys = new Set(allowed);
	for (const key of Object.keys(record)) {
		if (!allowedKeys.has(key))
			throw new Error(`Unexpected ${schemaName}.${key}`);
	}
}

function parseDiffApplySuccess(value: unknown): DiffApplySuccessResponse {
	const record = asRecord(value);
	assertExactKeys(record, ["success", "search"], "DiffApplySuccess");
	if (record["success"] !== true || typeof record["search"] !== "string") {
		throw new Error("Expected DiffApplySuccess");
	}
	return { success: true, search: record["search"] };
}

function parseDiffApplyFailure(value: unknown): DiffApplyFailureResponse {
	const record = asRecord(value);
	assertExactKeys(record, ["success"], "DiffApplyFailure");
	if (record["success"] !== false) throw new Error("Expected DiffApplyFailure");
	return { success: false };
}

function parseJsonFixSuccess(value: unknown): JsonFixSuccessResponse {
	const record = asRecord(value);
	assertExactKeys(record, ["success", "fixed"], "JsonFixSuccess");
	if (record["success"] !== true || !("fixed" in record)) {
		throw new Error("Expected JsonFixSuccess");
	}
	return { success: true, fixed: record["fixed"] };
}

function parseJsonFixFailure(value: unknown): JsonFixFailureResponse {
	const record = asRecord(value);
	assertExactKeys(record, ["success"], "JsonFixFailure");
	if (record["success"] !== false) throw new Error("Expected JsonFixFailure");
	return { success: false };
}

function renderTypeScript(schema: ResponseSchema<unknown>): string {
	return schema.typeScript;
}

export const DiffApplySuccess = new LiteralResponseSchema(
	"DiffApplySuccess",
	`type DiffApplySuccess = {
  success: true;
  search: string;
};`,
	parseDiffApplySuccess,
);
export const DiffApplyFailure = new LiteralResponseSchema(
	"DiffApplyFailure",
	`type DiffApplyFailure = {
  success: false;
};`,
	parseDiffApplyFailure,
);
export const DiffApplyResponse = DiffApplySuccess.or(DiffApplyFailure);

export function fixEditPrompt(brokenEdit: { file: string; edit: DiffEdit }) {
	return `The following diff edit is invalid: the search string does not match perfectly with the file contents.
Your task is to fix the search string if possible.

Respond only with JSON in the following format, defined as TypeScript types:

// Response if you fixed the search string:
${renderTypeScript(DiffApplySuccess)}

// Response if the edit is impossible to fix (search string is ambiguous or has no clear matches):
${renderTypeScript(DiffApplyFailure)}

Here's the broken edit and underlying file it's being applied to:
${JSON.stringify(brokenEdit)}`;
}

export const JsonFixSuccess = new LiteralResponseSchema(
	"JsonFixSuccess",
	`type JsonFixSuccess = {
  success: true;
  fixed: unknown; // The parsed JSON
};`,
	parseJsonFixSuccess,
);
export const JsonFixFailure = new LiteralResponseSchema(
	"JsonFixFailure",
	`type JsonFixFailure = {
  success: false;
};`,
	parseJsonFixFailure,
);
export const JsonFixResponseSchema = JsonFixSuccess.or(JsonFixFailure);

export function fixJsonPrompt(str: string) {
	return `The following string may be broken JSON. Fix it if possible. Respond with JSON in the following
format, defined as TypeScript types:

// Success response:
${renderTypeScript(JsonFixSuccess)}

// Failure response:
${renderTypeScript(JsonFixFailure)}

If it's more-or-less JSON, fix it and respond with the success response. If it's not, respond with
the failure response. Here's the string:
${str}`;
}
