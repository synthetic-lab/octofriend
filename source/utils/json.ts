import { tryexpr } from "../tryexpr.ts";

// Handles double-encoded arguments, which models sometimes produce
// example: '{"tool": "calculator", "args": {"x": 10, "y": 20}}' -> {tool: "calculator", args: {x: 10, y: 20}}
export function recursivelyDecodeStrings(value: any, depth = 0): any {
  if (depth > 10) return value;

  if (typeof value === "string") {
    const [parseErr, parsed] = tryexpr(() => JSON.parse(value));
    if (!parseErr) {
      return recursivelyDecodeStrings(parsed, depth + 1);
    }
  } else if (typeof value === "object" && value !== null) {
    const result: Record<string, any> = {};
    for (const [key, val] of Object.entries(value)) {
      result[key] = recursivelyDecodeStrings(val, depth + 1);
    }
    return result;
  }
  return value;
}
