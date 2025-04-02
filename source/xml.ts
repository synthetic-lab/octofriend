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
  private buffer: string = ''; // Buffer for accumulating tag parts
  private currentTag: string = '';
  private currentAttrName: string = '';
  private currentAttrValue: string = '';
  private attributes: Record<string, string> = {};
  private quoteChar: string | null = null;
  private handlers: Partial<XMLEventHandlers>;
  
  constructor(handlers: Partial<XMLEventHandlers> = {}) {
    this.handlers = handlers;
  }

  /**
   * Process a chunk of XML text
   */
  write(chunk: string): void {
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
        this.processTextState(char);
        break;
      case ParserState.TAG_START:
        this.processTagStartState(char);
        break;
      case ParserState.OPENING_TAG:
        this.processOpeningTagState(char);
        break;
      case ParserState.CLOSING_TAG:
        this.processClosingTagState(char);
        break;
      case ParserState.ATTRIBUTE_NAME:
        this.processAttributeNameState(char);
        break;
      case ParserState.ATTRIBUTE_VALUE_START:
        this.processAttributeValueStartState(char);
        break;
      case ParserState.ATTRIBUTE_VALUE:
        this.processAttributeValueState(char);
        break;
    }
  }

  private processTextState(char: string): void {
    if (char === '<') {
      // We might be starting a tag
      if (this.buffer) {
        this.emitText(this.buffer);
        this.buffer = '';
      }
      this.buffer = '<';
      this.state = ParserState.TAG_START;
    } else {
      // We're in regular text
      this.emitText(char);
    }
  }

  private processTagStartState(char: string): void {
    if (char === '/') {
      // This is a closing tag
      this.buffer += char;
      this.state = ParserState.CLOSING_TAG;
      this.currentTag = '';
    } else if (this.isValidTagNameChar(char, true)) {
      // This is an opening tag
      this.buffer += char;
      this.currentTag = char;
      this.state = ParserState.OPENING_TAG;
      this.attributes = {};
    } else {
      // This is not a valid tag, treat as text
      this.emitText(this.buffer + char);
      this.buffer = '';
      this.state = ParserState.TEXT;
    }
  }

  private processOpeningTagState(char: string): void {
    if (this.isValidTagNameChar(char, false)) {
      // Continue building the tag name
      this.buffer += char;
      this.currentTag += char;
    } else if (char === '>' || char === '/' || this.isWhitespace(char)) {
      this.buffer += char;
      
      if (this.isWhitespace(char)) {
        // Moving to attributes
        this.state = ParserState.ATTRIBUTE_NAME;
      } else if (char === '>') {
        this.emitOpenTag(this.currentTag, this.attributes);
        this.buffer = '';
        this.state = ParserState.TEXT;
      } else if (char === '/') {
        // This might be a self-closing tag, need to check next char
        // Stay in the same state, we'll handle it on the next char
      }
    } else {
      // Invalid character in tag name
      this.emitText(this.buffer + char);
      this.buffer = '';
      this.state = ParserState.TEXT;
    }
  }

  private processClosingTagState(char: string): void {
    if (this.isValidTagNameChar(char, true) || this.isValidTagNameChar(char, false)) {
      // Continue building the closing tag name
      this.buffer += char;
      this.currentTag += char;
    } else if (char === '>') {
      // End of closing tag
      this.buffer += char;
      this.emitCloseTag(this.currentTag);
      this.buffer = '';
      this.state = ParserState.TEXT;
    } else if (this.isWhitespace(char)) {
      // Whitespace after tag name is allowed
      this.buffer += char;
    } else {
      // Invalid character in closing tag
      this.emitText(this.buffer + char);
      this.buffer = '';
      this.state = ParserState.TEXT;
    }
  }

  private processAttributeNameState(char: string): void {
    if (this.isValidAttrNameChar(char)) {
      // Building attribute name
      this.buffer += char;
      this.currentAttrName += char;
    } else if (char === '=') {
      // End of attribute name, moving to attribute value
      this.buffer += char;
      this.state = ParserState.ATTRIBUTE_VALUE_START;
    } else if (this.isWhitespace(char)) {
      // Whitespace after attribute name
      this.buffer += char;
      if (this.currentAttrName) {
        // This is a boolean attribute (no value)
        this.attributes[this.currentAttrName] = '';
        this.currentAttrName = '';
      }
    } else if (char === '>') {
      // End of opening tag
      this.buffer += char;
      if (this.currentAttrName) {
        // This is a boolean attribute (no value)
        this.attributes[this.currentAttrName] = '';
      }
      this.emitOpenTag(this.currentTag, this.attributes);
      this.buffer = '';
      this.state = ParserState.TEXT;
    } else if (char === '/') {
      // Potential self-closing tag
      this.buffer += char;
      if (this.currentAttrName) {
        // This is a boolean attribute (no value)
        this.attributes[this.currentAttrName] = '';
        this.currentAttrName = '';
      }
    } else {
      // Invalid character in attribute name
      this.emitText(this.buffer + char);
      this.buffer = '';
      this.state = ParserState.TEXT;
    }
  }

  private processAttributeValueStartState(char: string): void {
    if (char === '"' || char === "'") {
      // Start of quoted attribute value
      this.buffer += char;
      this.quoteChar = char;
      this.currentAttrValue = '';
      this.state = ParserState.ATTRIBUTE_VALUE;
    } else if (!this.isWhitespace(char)) {
      // Unquoted attribute value
      this.buffer += char;
      this.currentAttrValue = char;
      this.state = ParserState.ATTRIBUTE_VALUE;
      this.quoteChar = null;
    } else {
      // Whitespace before attribute value
      this.buffer += char;
    }
  }

  private processAttributeValueState(char: string): void {
    if (this.quoteChar && char === this.quoteChar) {
      // End of quoted attribute value
      this.buffer += char;
      this.attributes[this.currentAttrName] = this.currentAttrValue;
      this.currentAttrName = '';
      this.currentAttrValue = '';
      this.quoteChar = null;
      this.state = ParserState.ATTRIBUTE_NAME;
    } else if (!this.quoteChar && (this.isWhitespace(char) || char === '>' || char === '/')) {
      // End of unquoted attribute value
      if (char === '>') {
        // '>' terminates the attribute value AND the tag
        this.attributes[this.currentAttrName] = this.currentAttrValue.split('>')[0];
        this.buffer += '>';
        this.emitOpenTag(this.currentTag, this.attributes);
        this.buffer = '';
        this.state = ParserState.TEXT;
      } else {
        // Space or '/' terminates just the attribute value
        this.attributes[this.currentAttrName] = this.currentAttrValue;
        this.currentAttrName = '';
        this.currentAttrValue = '';
        this.buffer += char;
        
        if (this.isWhitespace(char)) {
          this.state = ParserState.ATTRIBUTE_NAME;
        } else if (char === '/') {
          // Potential self-closing tag, wait for '>'
        }
      }
    } else {
      // Continue building attribute value
      this.buffer += char;
      this.currentAttrValue += char;
    }
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
    
    // Reset the state
    this.state = ParserState.TEXT;
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
}
