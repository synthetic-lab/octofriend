import { zeroToN, randomIndex } from "../random.ts";
const MAX_DEPTH = 3;
const MAX_ARRAY_LENGTH = 15;
const MAX_OBJECT_KEYS = 10;
const MAX_STRING_LENGTH = 50;
const MAX_NUMBER = 1000000;

function generateValue(depth: number): any {
  // At max depth, only primitives
  if (depth >= MAX_DEPTH) {
    const type = Math.floor(Math.random() * 4);
    switch (type) {
      case 0: return generateString();
      case 1: return generateNumber();
      case 2: return Math.random() < 0.5;
      case 3: return null;
    }
  }

  // Pick type uniformly
  if(Math.random() > 0.5) return generateArray(depth);
  return generateObject(depth);
}

function generateString(): string {
  const length = Math.floor(Math.random() * MAX_STRING_LENGTH);
  let result = '';

  for (let i = 0; i < length; i++) {
    const r = Math.random();

    if (r < 0.1) {
      // Common escape sequences
      const escapes = ['\n', '\r', '\t', '\b', '\f', '"', '\\', '/'];
      result += escapes[Math.floor(Math.random() * escapes.length)];
    } else if (r < 0.7) {
      // Basic multilingual plane (most common characters)
      let codePoint = Math.floor(Math.random() * 0x10000);
      // Skip surrogate range
      if (codePoint >= 0xD800 && codePoint <= 0xDFFF) {
        codePoint = 0x1F600 + Math.floor(Math.random() * 100); // Some emojis instead
      }
      result += String.fromCharCode(codePoint);
    } else {
      // Full Unicode range (using fromCodePoint for astral planes)
      let codePoint = Math.floor(Math.random() * 0x110000);
      // Skip surrogate range
      if (codePoint >= 0xD800 && codePoint <= 0xDFFF) {
        codePoint = 0x1F300 + Math.floor(Math.random() * 0x400); // Emoji range
      }
      result += String.fromCodePoint(codePoint);
    }
  }

  return result;
}

function generateNumber(): number {
  return (Math.random() * MAX_NUMBER * 2) - MAX_NUMBER;
}

function generateArray(depth: number): any[] {
  const length = Math.floor(Math.random() * MAX_ARRAY_LENGTH);
  const arr: any[] = [];

  for (let i = 0; i < length; i++) {
    arr.push(generateValue(depth + 1));
  }

  return arr;
}

function generateObject(depth: number): Record<string, any> {
  const keyCount = Math.floor(Math.random() * MAX_OBJECT_KEYS);
  const obj: Record<string, any> = {};

  for (let i = 0; i < keyCount; i++) {
    const key = generateKey();
    obj[key] = generateValue(depth + 1);
  }

  return obj;
}

const alphabet = 'abcdefghijklmnopqrstuvwxyz';
const KEY_CHARS = alphabet.toUpperCase() + alphabet + '0123456789-_!@#$%^&*()+=<>/';
function generateKey(): string {
  const length = 1 + Math.floor(Math.random() * 20);
  let key = '';

  for (let i = 0; i < length; i++) {
    key += KEY_CHARS[randomIndex(KEY_CHARS)];
  }

  return key;
}

export function generateJSON(allowRaw?: boolean): string {
  const max = allowRaw ? MAX_DEPTH : MAX_DEPTH - 1;
  return JSON.stringify(generateValue(zeroToN(max)));
}
