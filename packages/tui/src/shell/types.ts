export type Attribute = {
	name: string;
	value: string;
};

export type OpenTagEvent = {
	type: "openTag";
	name: string;
	attributes: Record<string, string>;
};

export type CloseTagEvent = {
	type: "closeTag";
	name: string;
};

export type TextEvent = {
	type: "text";
	content: string;
};

export type XMLEvent = OpenTagEvent | CloseTagEvent | TextEvent;

export type XMLEventHandlers = {
	onOpenTag: (event: OpenTagEvent) => void;
	onCloseTag: (event: CloseTagEvent) => void;
	onText: (event: TextEvent) => void;
};
