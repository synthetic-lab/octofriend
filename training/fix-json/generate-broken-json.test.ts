import { describe, it, expect } from 'vitest';
import { withMock } from 'antipattern';
import { deps } from '../random.ts';
import {
  BreakNode,
  nullCut,
  nullAdd,
  boolCut,
  boolAdd,
  numberDot,
  strUnescape,
  strRemoveQuote,
  strEscapeQuote,
  strPrefixQuote,
  strPostfixQuote,
  cutComma,
  dupeComma,
  cutClose,
  cutOpen,
  cutColon,
  dupeColon
} from './generate-broken-json.js';


describe('JSON fuzzing functions', () => {
  const mockRandom = (returnValues: number[]) => {
    let index = 0;
    return () => {
      return returnValues[index++] ?? 0.5;
    };
  };

  describe('null manipulation functions', () => {
    it('nullCut should cut a character from null', async () => {
      const testValues = [0.5]; // Mock random to return 0.5 for index
      
      await withMock(deps, 'random', mockRandom(testValues), () => {
        const result = nullCut({
          type: 'null',
          broken: 'null',
          node: {
            type: 'null',
            value: null,
            start: 0,
            end: 4,
            length: 4
          }
        });
        
        expect(result).toBeDefined();
        expect(result?.broken).toBe('nul'); // Cut first character
      });
    });

    it('nullAdd should insert random characters into null', async () => {
      const testValues = [0.5, 12 / 26]; // 0.5 for index, ~0.46 for lowercase letter 'm'

      await withMock(deps, 'random', mockRandom(testValues), () => {
        const result = nullAdd({
          type: 'null',
          broken: 'null',
          node: {
            type: 'null',
            value: null,
            start: 0,
            end: 4,
            length: 4
          }
        });

        expect(result).toBeDefined();
        expect(result?.broken).toEqual("nuall");
      });
    });
  });

  describe('boolean manipulation functions', () => {
    it('boolCut should cut a character from true', async () => {
      const testValues = [0.5];
      
      await withMock(deps, 'random', mockRandom(testValues), () => {
        const result = boolCut({
          type: 'boolean',
          broken: 'true',
          node: {
            type: 'boolean',
            value: true,
            start: 0,
            end: 4,
            length: 4
          }
        });
        
        expect(result).toBeDefined();
        expect(result?.broken).toBe('tre');
      });
    });

    it('boolAdd should insert random characters into boolean', async () => {
      const testValues = [0.5, 12 / 26]; // 0.5 for index, ~0.46 for lowercase letter 'm'
      
      await withMock(deps, 'random', mockRandom(testValues), () => {
        const result = boolAdd({
          type: 'boolean',
          broken: 'false',
          node: {
            type: 'boolean',
            value: false,
            start: 0,
            end: 5,
            length: 5
          }
        });
        
        expect(result).toBeDefined();
        expect(result?.broken).toMatch("faalse");
      });
    });
  });

  describe('number manipulation functions', () => {
    it('numberDot should add a decimal point', async () => {
      const result = numberDot({
        type: 'number',
        broken: '42',
        node: {
          type: 'number',
          value: 42,
          start: 0,
          end: 2,
          length: 2
        }
      });
      
      expect(result).toBeDefined();
      expect(result?.broken).toBe('42.');
    });
  });

  describe('string manipulation functions', () => {
    const mockStringNode = (str: string) => ({
      type: 'string' as const,
      broken: str,
      node: {
        type: 'string' as const,
        value: str,
        start: 0,
        end: str.length,
        length: str.length
      }
    });

    it('strUnescape should unescape escaped characters', async () => {
      const testValues = [0]; // First index for pickRandom
      
      await withMock(deps, 'random', mockRandom(testValues), () => {
        const result = strUnescape(mockStringNode('"Hello\\nWorld"'));
        expect(result).toBeDefined();
      });
    });

    it('strRemoveQuote should remove a quote from string', async () => {
      const testValues = [0]; // First index
      
      await withMock(deps, 'random', mockRandom(testValues), () => {
        const result = strRemoveQuote(mockStringNode('"Hello World"'));
        expect(result).toBeDefined();
      });
    });

    it('strEscapeQuote should escape quotes', async () => {
      const testValues = [0]; // First index
      
      await withMock(deps, 'random', mockRandom(testValues), () => {
        const result = strEscapeQuote(mockStringNode('"Hello \"World""'));
        expect(result).toBeDefined();
      });
    });

    it('strPrefixQuote should prepend quote', () => {
      const result = strPrefixQuote(mockStringNode('"Hello World"'));
      expect(result?.broken).toBe('""Hello World"');
    });

    it('strPostfixQuote should append quote', () => {
      const result = strPostfixQuote(mockStringNode('"Hello World"'));
      expect(result?.broken).toBe('"Hello World""');
    });
  });

  describe('comma manipulation functions', () => {
    const mockArrayNode = {
      type: 'array' as const,
      node: {
        type: 'array' as const,
        commaPositions: [1, 3, 5] as number[],
        children: [
          { type: 'number' as const, value: 1, start: 1, end: 2, length: 1 },
          { type: 'number' as const, value: 2, start: 3, end: 4, length: 1 },
          { type: 'number' as const, value: 3, start: 5, end: 6, length: 1 }
        ],
        start: 0,
        end: 7,
        length: 7,
        value: [1, 2, 3]
      },
      broken: {
        commaCuts: new Set<number>(),
        commaDupes: new Set<number>(),
        openCut: false,
        closeCut: false
      }
    };

    it('cutComma should cut a comma from the available positions', async () => {
      const testValues = [1]; // Second comma (index 1)
      
      await withMock(deps, 'random', mockRandom(testValues), () => {
        const result = cutComma(mockArrayNode);
        console.log(result);
        expect(result).toBeDefined();
        expect(result?.broken.commaCuts.size).toBe(1);
      });
    });

    it('dupeComma should duplicate a comma', async () => {
      const testValues = [1]; // Second comma
      
      await withMock(deps, 'random', mockRandom(testValues), () => {
        const result = dupeComma(mockArrayNode);
        expect(result).toBeDefined();
        expect(result?.broken.commaDupes).toBeDefined();
      });
    });

    it('cutComma should return null when no commas remain', () => {
      const exhaustedNode = {
        ...mockArrayNode,
        broken: {
          ...mockArrayNode.broken,
          commaCuts: new Set([0, 1, 2])
        }
      };
      const result = cutComma(exhaustedNode);
      expect(result).toBeNull();
    });
  });

  describe('bracket manipulation functions', () => {
    const mockBracesNode = {
      broken: {
        openCut: false,
        closeCut: false
      }
    };

    it('cutClose should cut closing bracket', () => {
      const result = cutClose(mockBracesNode);
      console.log(result);
      expect(result?.broken.closeCut).toBe(true);
    });

    it('cutOpen should cut opening bracket', () => {
      const result = cutOpen(mockBracesNode);
      expect(result?.broken.openCut).toBe(true);
    });

    it('cutClose should return null when already cut', () => {
      const alreadyCut = {
        broken: {
          openCut: true,
          closeCut: true
        }
      };
      const result = cutClose(alreadyCut);
      expect(result).toBeNull();
    });
  });

  describe('colon manipulation functions', () => {
    const mockObjectNode: BreakNode<"object"> = {
      type: 'object' as const,
      node: {
        type: 'object' as const,
        colonPositions: [1, 3] as number[],
        commaPositions: [2, 4] as number[],
        children: [
          [
            { type: 'string', value: 'a', start: 1, end: 2, length: 1 }, 
            { type: 'number', value: 1, start: 3, end: 4, length: 1 }
          ],
          [
            { type: 'string', value: 'b', start: 5, end: 6, length: 1 }, 
            { type: 'number', value: 2, start: 7, end: 8, length: 1 }
          ]
        ],
        start: 0,
        end: 9,
        length: 9,
        value: { a: 1, b: 2 }
      },
      broken: {
        colonCuts: new Set<number>(),
        colonDupes: new Set<number>(),
        commaCuts: new Set<number>(),
        commaDupes: new Set<number>(),
        openCut: false,
        closeCut: false
      }
    };

    it('cutColor should cut a colon', async () => {
      const testValues = [0];
      
      await withMock(deps, 'random', mockRandom(testValues), () => {
        const result = cutColon(mockObjectNode);
        expect(result).toBeDefined();
        expect(result?.broken.colonCuts.size).toBe(1);
      });
    });

    it('dupeColon should duplicate a colon', async () => {
      const testValues = [1];
      
      await withMock(deps, 'random', mockRandom(testValues), () => {
        const result = dupeColon(mockObjectNode);
        expect(result).toBeDefined();
        expect(result?.broken.colonDupes).toBeDefined();
      });
    });

    it('cutColor should return null when no colons remain', () => {
      const exhaustedNode = {
        ...mockObjectNode,
        broken: {
          ...mockObjectNode.broken,
          colonCuts: new Set([0, 1])
        }
      };
      const result = cutColon(exhaustedNode);
      expect(result).toBeNull();
    });
  });
});
