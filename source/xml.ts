// Simple streaming XML parser that handles partial tags and unbuffered text

/**
 * Possible states during XML parsing
 */
enum ParserState {
  TEXT = 'text',         // Processing regular text
  TAG_START = 'tagStart', // After "<", deciding if opening or closing tag
  CLOSING_TAG = 'closingTag', // Inside "</tag>"
  OPENING_TAG = 'openingTag', // Inside "<tag>"
  ATTRIBUTE_NAME = 'attrName', // Reading attribute name
  ATTRIBUTE_VALUE_START = 'attrValueStart', // After "=" before value
  ATTRIBUTE_VALUE = 'attrValue', // Inside attribute value
}

export type Attribute = {
  name: string;
  value: string;
};

export type OpenTagEvent = {
  type: 'openTag';
  name: string;
  attributes: Record<string, string>;
};

export type CloseTagEvent = {
  type: 'closeTag';
  name: string;
};

export type TextEvent = {
  type: 'text';
  content: string;
};

export type XMLEvent = OpenTagEvent | CloseTagEvent | TextEvent;

export type XMLEventHandlers = {
  onOpenTag: (event: OpenTagEvent) => void;
  onCloseTag: (event: CloseTagEvent) => void;
  onText: (event: TextEvent) => void;
};

/**
 * A simple streaming XML parser that handles partial chunks
 * and emits events without buffering text
 */
export class StreamingXMLParser {
  private state: ParserState = ParserState.TEXT;

  private buffer = ''; // Buffer for accumulating tag parts
  private currentTag = '';
  private currentAttrName = '';
  private currentAttrValue = '';

  private attributes: Record<string, string> = {};
  private quoteChar: string | null = null;
  private handlers: Partial<XMLEventHandlers>;
  private whitelist: string[] | null;

  private closed = false;

  constructor({ handlers, whitelist }: {
    handlers: Partial<XMLEventHandlers>,
    whitelist?: string[],
  }) {
    this.handlers = handlers;
    this.whitelist = whitelist || null;
  }

  /**
   * Process a chunk of XML text
   */
  write(chunk: string): void {
    if(this.closed) throw new Error("Writing to closed XML parser");

    if (!chunk) return;
    for (let i = 0; i < chunk.length; i++) {
      this.processChar(chunk[i]);
    }
  }

  /**
   * Process individual characters
   */
  private processChar(char: string): void {
    switch (this.state) {
      case ParserState.TEXT:
        return this.processTextState(char);
      case ParserState.TAG_START:
        return this.processTagStartState(char);
      case ParserState.OPENING_TAG:
        return this.processOpeningTagState(char);
      case ParserState.CLOSING_TAG:
        return this.processClosingTagState(char);
      case ParserState.ATTRIBUTE_NAME:
        return this.processAttributeNameState(char);
      case ParserState.ATTRIBUTE_VALUE_START:
        return this.processAttributeValueStartState(char);
      case ParserState.ATTRIBUTE_VALUE:
        return this.processAttributeValueState(char);
    }
  }

  private processTextState(char: string): void {
    if (char === '<') {
      // We might be starting a tag
      if(this.buffer) {
        this.emitText(this.buffer);
        this.buffer = '';
      }
      this.buffer = char;
      this.state = ParserState.TAG_START;
    } else {
      // We're in regular text
      this.emitText(char);
    }
  }

  private processTagStartState(char: string): void {
    this.buffer += char;

    if (char === '/') {
      // This is a closing tag
      this.state = ParserState.CLOSING_TAG;
      this.currentTag = '';
      return;
    }

    if (this.isValidTagNameChar(char, true)) {
      this.currentTag = char;

      if(this.failWhitelistProgress("", char)) {
        this.emitTextAndReset(this.buffer);
        this.currentTag = "";
        return;
      }

      // This is an opening tag
      this.state = ParserState.OPENING_TAG;
      this.attributes = {};
      return;
    }

    // Fall through case for invalid tag starts
    this.emitTextAndReset(this.buffer);
  }

  private failWhitelistProgress(tag: string, char: string) {
    return this.whitelist && !this.whitelist.some(t => {
      return t.startsWith((tag + char));
    });
  }

  private failWhitelist(tag: string) {
    return this.whitelist && !this.whitelist.includes(tag);
  }

  private processOpeningTagState(char: string): void {
    this.buffer += char;

    if(this.isValidTagNameChar(char, false)) {
      if(this.failWhitelistProgress(this.currentTag, char)) {
        return this.emitTextAndReset(this.buffer);
      }
      this.currentTag += char;
      return;
    }

    // Got this far? We're no longer in progress collecting tag names. Check the entire tag
    if(this.failWhitelist(this.currentTag)) {
      return this.emitTextAndReset(this.buffer);
    }

    if(this.isWhitespace(char)) {
      // Moving to attributes
      this.state = ParserState.ATTRIBUTE_NAME;
      return;
    }

    if(char === ">") {
      this.emitOpenTag(this.currentTag, this.attributes);
      this.buffer = '';
      this.state = ParserState.TEXT;
      return;
    }

    if (char === "/") {
      // This might be a self-closing tag, need to check next char
      // Stay in the same state, we'll handle it on the next char
      return;
    }

    this.emitTextAndReset(this.buffer);
  }

  private processClosingTagState(char: string): void {
    this.buffer += char;

    if(this.isValidTagNameChar(char, true) || this.isValidTagNameChar(char, false)) {
      if(this.failWhitelistProgress(this.currentTag, char)) {
        return this.emitTextAndReset(this.buffer);
      }

      // Continue building the closing tag name
      this.currentTag += char;
      return;
    }

    if(this.failWhitelist(this.currentTag)) {
      return this.emitTextAndReset(this.buffer);
    }

    // End of closing tag
    if(char === ">") {
      this.emitCloseTag(this.currentTag);

      this.buffer = '';
      this.state = ParserState.TEXT;
      return;
    }

    if(this.isWhitespace(char)) {
      // Whitespace after tag name is allowed
      return;
    }

    this.emitTextAndReset(this.buffer);
  }

  private processAttributeNameState(char: string): void {
    this.buffer += char;

    if(this.isValidAttrNameChar(char)) {
      // Building attribute name
      this.currentAttrName += char;
      return;
    }

    if(char === '=') {
      // End of attribute name, moving to attribute value
      this.state = ParserState.ATTRIBUTE_VALUE_START;
      return;
    }

    if(this.isWhitespace(char)) {
      // Whitespace after attribute name
      if (this.currentAttrName) {
        // This is a boolean attribute (no value)
        this.attributes[this.currentAttrName] = '';
        this.currentAttrName = '';
      }
      return;
    }

    if(char === '>') {
      // End of opening tag
      if (this.currentAttrName) {
        // This is a boolean attribute (no value)
        this.attributes[this.currentAttrName] = '';
      }
      this.emitOpenTag(this.currentTag, this.attributes);
      this.buffer = '';
      this.state = ParserState.TEXT;
      return;
    }

    if(char === '/') {
      // Potential self-closing tag
      if (this.currentAttrName) {
        // This is a boolean attribute (no value)
        this.attributes[this.currentAttrName] = '';
        this.currentAttrName = '';
      }
      return;
    }

    this.emitTextAndReset(this.buffer);
  }

  private processAttributeValueStartState(char: string): void {
    this.buffer += char;

    if (char === '"' || char === "'") {
      // Start of quoted attribute value
      this.quoteChar = char;
      this.currentAttrValue = '';
      this.state = ParserState.ATTRIBUTE_VALUE;
      return;
    }

    // Whitespace before attribute value
    if(this.isWhitespace(char)) return;

    // Unquoted attribute value
    this.currentAttrValue = char;
    this.state = ParserState.ATTRIBUTE_VALUE;
    this.quoteChar = null;
  }

  private processAttributeValueState(char: string): void {
    this.buffer += char;

    if(this.quoteChar && char === this.quoteChar) {
      // End of quoted attribute value
      this.attributes[this.currentAttrName] = this.currentAttrValue;
      this.currentAttrName = '';
      this.currentAttrValue = '';
      this.quoteChar = null;
      this.state = ParserState.ATTRIBUTE_NAME;
      return;
    }

    if (!this.quoteChar && (this.isWhitespace(char) || char === '>' || char === '/')) {
      // End of unquoted attribute value
      if (char === '>') {
        // '>' terminates the attribute value AND the tag
        this.attributes[this.currentAttrName] = this.currentAttrValue.split('>')[0];
        this.emitOpenTag(this.currentTag, this.attributes);
        this.buffer = '';
        this.state = ParserState.TEXT;
      } else {
        // Space or '/' terminates just the attribute value
        this.attributes[this.currentAttrName] = this.currentAttrValue;
        this.currentAttrName = '';
        this.currentAttrValue = '';

        if (this.isWhitespace(char)) {
          this.state = ParserState.ATTRIBUTE_NAME;
        } else if (char === '/') {
          // Potential self-closing tag, wait for '>'
        }
      }
      return;
    }

    // Continue building attribute value
    this.currentAttrValue += char;
  }

  /**
   * Close the parser, handling any remaining buffered content
   */
  close(): void {
    // If we have anything in the buffer, emit it as text
    if (this.buffer) {
      this.emitText(this.buffer);
      this.buffer = '';
    }

    this.closed = true;
  }

  private emitText(text: string): void {
    if (text && this.handlers.onText) {
      this.handlers.onText({
        type: 'text',
        content: text
      });
    }
  }

  private emitOpenTag(name: string, attributes: Record<string, string>): void {
    if (this.handlers.onOpenTag) {
      const selfClosing = this.buffer.trimEnd().endsWith('/>');
      this.handlers.onOpenTag({
        type: 'openTag',
        name,
        attributes
      });

      if (selfClosing && this.handlers.onCloseTag) {
        this.handlers.onCloseTag({
          type: 'closeTag',
          name
        });
      }
    }
  }

  private emitCloseTag(name: string): void {
    if (this.handlers.onCloseTag) {
      this.handlers.onCloseTag({
        type: 'closeTag',
        name
      });
    }
  }

  // Helper methods for character classification
  private isWhitespace(char: string): boolean {
    return /\s/.test(char);
  }

  private isValidTagNameChar(char: string, isFirst: boolean): boolean {
    if (isFirst) {
      // First character of tag name must be a letter, underscore or colon
      return /[a-zA-Z_:]/.test(char);
    } else {
      // Subsequent characters can also include digits, hyphens, and periods
      return /[a-zA-Z0-9_:.-]/.test(char);
    }
  }

  private isValidAttrNameChar(char: string): boolean {
    return /[a-zA-Z0-9_:.-]/.test(char);
  }

  /**
   * Helper to emit text content and reset parser state to TEXT mode
   */
  private emitTextAndReset(content: string): void {
    this.emitText(content);
    this.buffer = '';
    this.state = ParserState.TEXT;
  }
}
