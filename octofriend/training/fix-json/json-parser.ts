export type ASTNodeType = 'object' | 'array' | 'string' | 'number' | 'boolean' | 'null';
export type ASTNode = {
  type: ASTNodeType;
  start: number;
  end: number;
  length: number;
  value: any;
};

export type ObjectNode = ASTNode & {
  type: 'object';
  value: Record<string, any>;
  colonPositions: number[],
  commaPositions: number[],
  children: Array<[ JSONASTNode, JSONASTNode ]>,
};

export type ArrayNode = ASTNode & {
  type: 'array';
  value: any[];
  commaPositions: number[],
  children: JSONASTNode[],
};

export type StringNode = ASTNode & {
  type: 'string';
  value: string;
};

export type NumberNode = ASTNode & {
  type: 'number';
  value: number;
};

export type BooleanNode = ASTNode & {
  type: 'boolean';
  value: boolean;
};

export type NullNode = ASTNode & {
  type: 'null';
  value: null;
};

export type JSONASTNode = ObjectNode | ArrayNode | StringNode | NumberNode | BooleanNode | NullNode;

export class JSONFuzzerParser {
  private input: string;
  private position: number;
  private nodes: JSONASTNode[];

  constructor(input: string) {
    this.input = input;
    this.position = 0;
    this.nodes = [];
  }

  parse(): JSONASTNode[] {
    this.position = 0;
    this.nodes = [];
    this.skipWhitespace();
    this.parseValue();
    return this.nodes;
  }

  private parseValue(): [ JSONASTNode, any ] {
    this.skipWhitespace();

    const char = this.input[this.position];

    switch (char) {
      case '{':
        return this.parseObject();
      case '[':
        return this.parseArray();
      case '"':
        return this.parseString();
      case 't':
      case 'f':
        return this.parseBoolean();
      case 'n':
        return this.parseNull();
      default:
        if (char === '-' || (char >= '0' && char <= '9')) {
          return this.parseNumber();
        }
        throw new Error(`Unexpected character '${char}' at position ${this.position}`);
    }
  }

  private parseObject(): [ ObjectNode, Record<string, any> ] {
    const start = this.position;
    const obj: Record<string, any> = {};
    const colonPositions: number[] = [];
    const commaPositions: number[] = [];
    const children: Array<[ JSONASTNode, JSONASTNode ]> = [];

    this.position++; // skip '{'
    this.skipWhitespace();

    let structuralChars = 1; // count '{'

    if (this.input[this.position] === '}') {
      this.position++; // skip '}'
      structuralChars++; // count '}'

      const node: ObjectNode = {
        type: 'object',
        start, colonPositions, commaPositions, children,
        end: this.position,
        length: structuralChars,
        value: obj,
      };
      this.nodes.push(node);
      return [ node, obj ];
    }

    while (true) {
      this.skipWhitespace();

      // Parse key
      if (this.input[this.position] !== '"') {
        throw new Error(`Expected string key at position ${this.position}`);
      }
      const [ childKey, key ] = this.parseString();

      this.skipWhitespace();

      // Expect colon
      if (this.input[this.position] !== ':') {
        throw new Error(`Expected ':' at position ${this.position}`);
      }
      colonPositions.push(this.position);
      this.position++; // skip ':'
      structuralChars++; // count ':'

      this.skipWhitespace();

      // Parse value
      const [ childValue, value ] = this.parseValue();
      obj[key] = value;

      children.push([ childKey, childValue ]);

      this.skipWhitespace();

      // Check for comma or end
      if (this.input[this.position] === ',') {
        commaPositions.push(this.position);
        this.position++; // skip ','
        structuralChars++; // count ','
      } else if (this.input[this.position] === '}') {
        this.position++; // skip '}'
        structuralChars++; // count '}'
        break;
      } else {
        throw new Error(`Expected ',' or '}' at position ${this.position}`);
      }
    }

    const node: ObjectNode = {
      type: 'object',
      start, commaPositions, colonPositions, children,
      end: this.position,
      length: structuralChars,
      value: obj
    };
    this.nodes.push(node);
    return [ node, obj ];
  }

  private parseArray(): [ ArrayNode, any[] ] {
    const start = this.position;
    const arr: any[] = [];
    const commaPositions: number[] = [];
    const children: JSONASTNode[] = [];

    this.position++; // skip '['
    this.skipWhitespace();

    let structuralChars = 1; // count '['

    if (this.input[this.position] === ']') {
      this.position++; // skip ']'
      structuralChars++; // count ']'

      const node: ArrayNode = {
        type: 'array',
        start, commaPositions, children,
        end: this.position,
        length: structuralChars,
        value: arr
      };
      this.nodes.push(node);
      return [ node, arr ];
    }

    while (true) {
      this.skipWhitespace();

      // Parse value
      const [ child, value ] = this.parseValue();
      arr.push(value);
      children.push(child);

      this.skipWhitespace();

      // Check for comma or end
      if (this.input[this.position] === ',') {
        commaPositions.push(this.position);
        this.position++; // skip ','
        structuralChars++; // count ','
      } else if (this.input[this.position] === ']') {
        this.position++; // skip ']'
        structuralChars++; // count ']'
        break;
      } else {
        throw new Error(`Expected ',' or ']' at position ${this.position}`);
      }
    }

    const node: ArrayNode = {
      type: 'array',
      start, commaPositions, children,
      end: this.position,
      length: structuralChars,
      value: arr
    };
    this.nodes.push(node);
    return [ node, arr ];
  }

  private parseString(): [ StringNode, string ] {
    const start = this.position;
    this.position++; // skip opening '"'

    let value = '';
    while (this.position < this.input.length) {
      const char = this.input[this.position];

      if (char === '"') {
        this.position++; // skip closing '"'
        const node: StringNode = {
          type: 'string',
          start,
          end: this.position,
          length: this.position - start,
          value
        };
        this.nodes.push(node);
        return [ node, value ];
      }

      if (char === '\\') {
        this.position++;
        if (this.position >= this.input.length) {
          throw new Error('Unexpected end of input in string escape');
        }

        const escapeChar = this.input[this.position];
        switch (escapeChar) {
          case '"':
          case '\\':
          case '/':
            value += escapeChar;
            break;
          case 'b':
            value += '\b';
            break;
          case 'f':
            value += '\f';
            break;
          case 'n':
            value += '\n';
            break;
          case 'r':
            value += '\r';
            break;
          case 't':
            value += '\t';
            break;
          case 'u':
            // Unicode escape
            this.position++;
            const hex = this.input.substr(this.position, 4);
            if (hex.length !== 4 || !/^[0-9a-fA-F]{4}$/.test(hex)) {
              throw new Error('Invalid unicode escape sequence');
            }
            value += String.fromCharCode(parseInt(hex, 16));
            this.position += 3; // we'll increment by 1 at the end of the loop
            break;
          default:
            throw new Error(`Invalid escape sequence '\\${escapeChar}'`);
        }
      } else {
        value += char;
      }

      this.position++;
    }

    throw new Error('Unterminated string');
  }

  private parseNumber(): [ NumberNode, number ] {
    const start = this.position;
    let numStr = '';

    // Optional minus
    if (this.input[this.position] === '-') {
      numStr += '-';
      this.position++;
    }

    // Integer part
    if (this.input[this.position] === '0') {
      numStr += '0';
      this.position++;
    } else if (this.input[this.position] >= '1' && this.input[this.position] <= '9') {
      while (this.position < this.input.length &&
             this.input[this.position] >= '0' &&
             this.input[this.position] <= '9') {
        numStr += this.input[this.position];
        this.position++;
      }
    } else {
      throw new Error(`Invalid number at position ${this.position}`);
    }

    // Fractional part
    if (this.position < this.input.length && this.input[this.position] === '.') {
      numStr += '.';
      this.position++;

      if (!(this.input[this.position] >= '0' && this.input[this.position] <= '9')) {
        throw new Error('Invalid number: expected digit after decimal point');
      }

      while (this.position < this.input.length &&
             this.input[this.position] >= '0' &&
             this.input[this.position] <= '9') {
        numStr += this.input[this.position];
        this.position++;
      }
    }

    // Exponent part
    if (this.position < this.input.length &&
        (this.input[this.position] === 'e' || this.input[this.position] === 'E')) {
      numStr += this.input[this.position];
      this.position++;

      if (this.input[this.position] === '+' || this.input[this.position] === '-') {
        numStr += this.input[this.position];
        this.position++;
      }

      if (!(this.input[this.position] >= '0' && this.input[this.position] <= '9')) {
        throw new Error('Invalid number: expected digit in exponent');
      }

      while (this.position < this.input.length &&
             this.input[this.position] >= '0' &&
             this.input[this.position] <= '9') {
        numStr += this.input[this.position];
        this.position++;
      }
    }

    const value = parseFloat(numStr);
    const node: NumberNode = {
      type: 'number',
      start,
      end: this.position,
      length: this.position - start,
      value
    };
    this.nodes.push(node);
    return [ node, value ];
  }

  private parseBoolean(): [ BooleanNode, boolean ] {
    const start = this.position;

    if (this.input.substr(this.position, 4) === 'true') {
      this.position += 4;
      const node: BooleanNode = {
        type: 'boolean',
        start,
        end: this.position,
        length: 4,
        value: true
      };
      this.nodes.push(node);
      return [ node, true ];
    } else if (this.input.substr(this.position, 5) === 'false') {
      this.position += 5;
      const node: BooleanNode = {
        type: 'boolean',
        start,
        end: this.position,
        length: 5,
        value: false
      };
      this.nodes.push(node);
      return [ node, false ];
    }

    throw new Error(`Invalid boolean at position ${this.position}`);
  }

  private parseNull(): [ NullNode, null ] {
    const start = this.position;

    if (this.input.substr(this.position, 4) === 'null') {
      this.position += 4;
      const node: NullNode = {
        type: 'null',
        start,
        end: this.position,
        length: 4,
        value: null
      };
      this.nodes.push(node);
      return [ node, null ];
    }

    throw new Error(`Invalid null at position ${this.position}`);
  }

  private skipWhitespace(): void {
    while (this.position < this.input.length) {
      const char = this.input[this.position];
      if (char === ' ' || char === '\t' || char === '\n' || char === '\r') {
        this.position++;
      } else {
        break;
      }
    }
  }
}

export function parseJson(jsonString: string): JSONASTNode[] {
  const parser = new JSONFuzzerParser(jsonString);
  return parser.parse();
}
