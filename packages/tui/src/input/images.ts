import {
	extractBase64FromDataUrl as extractBase64FromDataUrlImpl,
	getMimeTypeFromDataUrl as getMimeTypeFromDataUrlImpl,
	getMimeTypeFromPath as getMimeTypeFromPathImpl,
	loadImageFromPath as loadImageFromPathImpl,
} from "./image-loading";
import {
	isImagePath as isImagePathImpl,
	parseImagePaths as parseImagePathsImpl,
	replaceInputWithSafeCharacters as replaceInputWithSafeCharactersImpl,
	separateFilePaths as separateFilePathsImpl,
} from "./image-paths";
import type {
	ImageInfo as ImageInfoType,
	ImageMimeType as ImageMimeTypeType,
} from "./image-types";

export type ImageMimeType = ImageMimeTypeType;
export type ImageInfo = ImageInfoType;

export const isImagePath = isImagePathImpl;
export const replaceInputWithSafeCharacters =
	replaceInputWithSafeCharactersImpl;
export const separateFilePaths = separateFilePathsImpl;
export const parseImagePaths = parseImagePathsImpl;
export const getMimeTypeFromPath = getMimeTypeFromPathImpl;
export const loadImageFromPath = loadImageFromPathImpl;
export const getMimeTypeFromDataUrl = getMimeTypeFromDataUrlImpl;
export const extractBase64FromDataUrl = extractBase64FromDataUrlImpl;
