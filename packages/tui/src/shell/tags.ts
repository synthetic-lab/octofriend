export function openTag(tag: string, attrs?: Record<string, string>) {
	if (!attrs) return `<${tag}>`;
	let renderedAttrs = "";
	for (const key in attrs) {
		if (!Object.hasOwn(attrs, key)) continue;
		const value = attrs[key];
		if (value === undefined) continue;
		renderedAttrs +=
			renderedAttrs.length === 0 ? `${key}="${value}"` : ` ${key}="${value}"`;
	}
	return renderedAttrs.length === 0 ? `<${tag}>` : `<${tag} ${renderedAttrs}>`;
}

export function closeTag(tag: string) {
	return `</${tag}>`;
}

export function tagged(
	tag: string,
	attrs: Record<string, string> = {},
	...content: string[]
) {
	const renderedContent = content.length === 0 ? "" : content.join("");
	return openTag(tag, attrs) + renderedContent + closeTag(tag);
}

export function xmlEscape(value: string) {
	let escapedParts: string[] | undefined;
	let copyStart = 0;
	let index = 0;
	while (index < value.length) {
		const replacement = xmlEscapeReplacement(value.charCodeAt(index));
		if (replacement !== undefined) {
			if (escapedParts === undefined) escapedParts = [];
			if (copyStart < index)
				escapedParts[escapedParts.length] = value.slice(copyStart, index);
			escapedParts[escapedParts.length] = replacement;
			copyStart = index + 1;
		}
		index += 1;
	}
	if (copyStart === 0) return value;
	if (copyStart < value.length) {
		if (escapedParts === undefined) return value.slice(copyStart);
		escapedParts[escapedParts.length] = value.slice(copyStart);
	}
	return escapedParts?.join("") ?? "";
}

function xmlEscapeReplacement(charCode: number): string | undefined {
	if (charCode === 38) return "&amp;";
	if (charCode === 60) return "&lt;";
	if (charCode === 62) return "&gt;";
	if (charCode === 34) return "&quot;";
	if (charCode === 39) return "&apos;";
	return undefined;
}
