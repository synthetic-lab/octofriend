function isInvisibleTextCode(charCode: number): boolean {
	if (charCode >= 9 && charCode <= 13) return true;
	if (charCode === 32 || charCode === 133 || charCode === 160) return true;
	if (charCode === 5760 || charCode === 6158) return true;
	if (charCode >= 8192 && charCode <= 8207) return true;
	if (charCode >= 8294 && charCode <= 8303) return true;
	if (charCode >= 65024 && charCode <= 65039) return true;
	return (
		charCode === 8232 ||
		charCode === 8233 ||
		charCode === 8239 ||
		charCode === 8287 ||
		charCode === 8288 ||
		charCode === 12288 ||
		charCode === 65279
	);
}

export function hasVisibleText(
	value: string | null | undefined,
): value is string {
	if (!value) return false;
	for (let index = 0; index < value.length; index += 1) {
		if (!isInvisibleTextCode(value.charCodeAt(index))) return true;
	}
	return false;
}
