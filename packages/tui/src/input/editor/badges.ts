import stringWidth from "string-width";

const MAX_CACHED_IMAGE_BADGES = 64;
const cachedImageBadgeTexts = new Array<string | undefined>(
	MAX_CACHED_IMAGE_BADGES,
);
const cachedImageBadgeWidths = new Int32Array(MAX_CACHED_IMAGE_BADGES);

function createImageBadgeText(index: number): string {
	return `⟦ 📎 Image Attachment #${index + 1} ⟧`;
}

export function getImageBadgeText(index: number): string {
	if (index < 0 || index >= MAX_CACHED_IMAGE_BADGES) {
		return createImageBadgeText(index);
	}
	let badgeText = cachedImageBadgeTexts[index];
	if (badgeText === undefined) {
		badgeText = createImageBadgeText(index);
		cachedImageBadgeTexts[index] = badgeText;
	}
	return badgeText;
}

export function getImageBadgeWidth(index: number): number {
	if (index < 0 || index >= MAX_CACHED_IMAGE_BADGES) {
		return stringWidth(createImageBadgeText(index)) + 1;
	}
	let width = cachedImageBadgeWidths[index];
	if (width === 0) {
		width = stringWidth(getImageBadgeText(index)) + 1;
		cachedImageBadgeWidths[index] = width;
	}
	return width;
}

export const LOADING_BADGE_TEXT = "⟦ ⏳ Attaching image... ⟧";
const LOADING_BADGE_WIDTH = stringWidth(LOADING_BADGE_TEXT) + 1;

export type ImageBadgeLayoutItem = { index: number; isLoading: boolean };

export const EMPTY_IMAGE_BADGE_ROWS: ImageBadgeLayoutItem[][] = [];

export type ImageBadgeLayout = {
	badgeRows: ImageBadgeLayoutItem[][];
	remainingWidthForText: number;
};

export function computeImageBadgeLayout(
	imageCount: number,
	isLoading: boolean,
	containerWidth: number,
): ImageBadgeLayout {
	const totalItems = imageCount + (isLoading ? 1 : 0);
	if (totalItems === 0) {
		return {
			badgeRows: EMPTY_IMAGE_BADGE_ROWS,
			remainingWidthForText: containerWidth,
		};
	}

	const badgeRows: ImageBadgeLayoutItem[][] = [];
	let currentRow: ImageBadgeLayoutItem[] = [];
	let currentRowWidth = 0;

	for (let i = 0; i < totalItems; i++) {
		const isCurrentLoading = isLoading && i === totalItems - 1;
		const currentBadgeWidth = isCurrentLoading
			? LOADING_BADGE_WIDTH
			: getImageBadgeWidth(i);

		if (
			currentRow.length > 0 &&
			currentRowWidth + currentBadgeWidth > containerWidth
		) {
			badgeRows[badgeRows.length] = currentRow;
			currentRow = new Array<ImageBadgeLayoutItem>(1);
			currentRow[0] = { index: i, isLoading: isCurrentLoading };
			currentRowWidth = currentBadgeWidth;
		} else {
			currentRow[currentRow.length] = { index: i, isLoading: isCurrentLoading };
			currentRowWidth += currentBadgeWidth;
		}
	}

	let remainingWidthForText = containerWidth;

	if (currentRow.length > 0) {
		badgeRows[badgeRows.length] = currentRow;
		remainingWidthForText = containerWidth - currentRowWidth;
	}

	return { badgeRows, remainingWidthForText };
}
