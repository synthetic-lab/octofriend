// Simple streaming XML parser that handles partial tags and streams contiguous text

import {
	closeTag as closeTagImpl,
	openTag as openTagImpl,
	tagged as taggedImpl,
	xmlEscape as xmlEscapeImpl,
} from "./tags";
import type {
	Attribute as AttributeType,
	CloseTagEvent as CloseTagEventType,
	OpenTagEvent as OpenTagEventType,
	TextEvent as TextEventType,
	XMLEventHandlers as XMLEventHandlersType,
	XMLEvent as XMLEventType,
} from "./types";
import { StreamingXMLParser as StreamingXMLParserImpl } from "./xml-stream";

export type Attribute = AttributeType;
export type OpenTagEvent = OpenTagEventType;
export type CloseTagEvent = CloseTagEventType;
export type TextEvent = TextEventType;
export type XMLEvent = XMLEventType;
export type XMLEventHandlers = XMLEventHandlersType;

export const StreamingXMLParser = StreamingXMLParserImpl;
export const openTag = openTagImpl;
export const closeTag = closeTagImpl;
export const tagged = taggedImpl;
export const xmlEscape = xmlEscapeImpl;
