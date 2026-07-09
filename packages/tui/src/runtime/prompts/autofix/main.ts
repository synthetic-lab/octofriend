import { convert as htmlToText } from "html-to-text";
import { marked } from "marked";
import { z } from "zod";

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
	jsonSchema(): unknown;
	slice(value: unknown): T;
	or<Other>(other: ResponseSchema<Other>): ResponseSchema<T | Other>;
};

class ZodResponseSchema<T> implements ResponseSchema<T> {
	readonly name: string;
	readonly #schema: z.ZodType<T>;

	constructor(name: string, schema: z.ZodType<T>) {
		this.name = name;
		this.#schema = schema;
	}

	jsonSchema(): unknown {
		return z.toJSONSchema(this.#schema, { target: "draft-7" });
	}

	slice(value: unknown): T {
		return this.#schema.parse(value);
	}

	or<Other>(other: ResponseSchema<Other>): ResponseSchema<T | Other> {
		return new UnionResponseSchema(this, other);
	}
}

class UnionResponseSchema<A, B> implements ResponseSchema<A | B> {
	readonly name: string;
	readonly #left: ResponseSchema<A>;
	readonly #right: ResponseSchema<B>;

	constructor(left: ResponseSchema<A>, right: ResponseSchema<B>) {
		this.#left = left;
		this.#right = right;
		this.name = `${left.name} | ${right.name}`;
	}

	jsonSchema(): unknown {
		return {
			$schema: "http://json-schema.org/draft-07/schema#",
			anyOf: [
				withoutSchemaKey(this.#left.jsonSchema()),
				withoutSchemaKey(this.#right.jsonSchema()),
			],
		};
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

const FIX_EDIT_PROMPT = await Bun.file(
	new URL("./templates/fix_edit.md", import.meta.url),
).text();
const FIX_JSON_PROMPT = await Bun.file(
	new URL("./templates/fix_json.md", import.meta.url),
).text();

function renderTemplate(
	template: string,
	values: Record<string, string>,
): string {
	const { protectedTemplate, placeholders } = protectTemplateLiterals(template);
	const renderedMarkdown = renderMarkdownText(protectedTemplate);
	return restoreTemplateLiterals(renderedMarkdown, placeholders)
		.replaceAll(/\{\{([A-Za-z0-9_]+)\}\}/gu, (placeholder, key) =>
			Object.hasOwn(values, key) ? values[key] : placeholder,
		)
		.trimEnd();
}

function protectTemplateLiterals(template: string): {
	protectedTemplate: string;
	placeholders: Map<string, string>;
} {
	let index = 0;
	const placeholders = new Map<string, string>();
	const protectedTemplate = template.replaceAll(
		/\{\{[A-Za-z0-9_]+\}\}|<\/?[A-Za-z][^>\n]*>/gu,
		(literal) => {
			const token = `\u{E000}${index}\u{E001}`;
			index += 1;
			placeholders.set(token, literal);
			return token;
		},
	);
	return { protectedTemplate, placeholders };
}

function restoreTemplateLiterals(
	template: string,
	placeholders: Map<string, string>,
): string {
	let restored = template;
	for (const [token, placeholder] of placeholders) {
		restored = restored.replaceAll(token, placeholder);
	}
	return restored;
}

function renderMarkdownText(markdown: string): string {
	const html = marked.parse(markdown, {
		async: false,
		breaks: true,
		gfm: true,
	}) as string;
	return htmlToText(html, {
		wordwrap: false,
		selectors: [
			{ selector: "h1", options: { uppercase: false } },
			{ selector: "h2", options: { uppercase: false } },
			{ selector: "h3", options: { uppercase: false } },
			{ selector: "h4", options: { uppercase: false } },
			{ selector: "h5", options: { uppercase: false } },
			{ selector: "h6", options: { uppercase: false } },
			{ selector: "table", options: { uppercaseHeaderCells: false } },
		],
	}).trimEnd();
}

function schemaJson(schema: ResponseSchema<unknown>): string {
	return JSON.stringify(schema.jsonSchema(), null, 2);
}

function withoutSchemaKey(value: unknown): unknown {
	if (typeof value !== "object" || value === null || Array.isArray(value)) {
		return value;
	}
	const { $schema: _schema, ...rest } = value as Record<string, unknown>;
	return rest;
}

export const DiffApplySuccess = new ZodResponseSchema(
	"DiffApplySuccess",
	z.strictObject({ success: z.literal(true), search: z.string() }),
);
export const DiffApplyFailure = new ZodResponseSchema(
	"DiffApplyFailure",
	z.strictObject({ success: z.literal(false) }),
);
export const DiffApplyResponse = DiffApplySuccess.or(DiffApplyFailure);

export function fixEditPrompt(brokenEdit: { file: string; edit: DiffEdit }) {
	return renderTemplate(FIX_EDIT_PROMPT, {
		diff_apply_response_schema: schemaJson(DiffApplyResponse),
		broken_edit_json: JSON.stringify(brokenEdit),
	});
}

export const JsonFixSuccess = new ZodResponseSchema(
	"JsonFixSuccess",
	z.strictObject({ success: z.literal(true), fixed: z.unknown() }),
);
export const JsonFixFailure = new ZodResponseSchema(
	"JsonFixFailure",
	z.strictObject({ success: z.literal(false) }),
);
export const JsonFixResponseSchema = JsonFixSuccess.or(JsonFixFailure);

export function fixJsonPrompt(str: string) {
	return renderTemplate(FIX_JSON_PROMPT, {
		json_fix_response_schema: schemaJson(JsonFixResponseSchema),
		input: str,
	});
}
