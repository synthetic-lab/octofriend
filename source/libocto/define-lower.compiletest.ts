import { defineLower } from "./define-lower.ts";
import type { IRConversion } from "./llm-ir.ts";

type Input = { role: "note"; text: string };
type Output = { role: "rendered-note"; text: string };
type Trajectory = { role: "subagent-trajectory"; ir: Input[] };

// Clients declare input and output IR. Custom output roles need not be libocto built-ins.
const render = defineLower(
  (messages: Input[], suffix: string = "!"): Array<IRConversion<Input, Output>> =>
    messages.map(original => ({
      original,
      converted: { role: "rendered-note", text: original.text + suffix },
    })),
);
const rendered: Array<IRConversion<Input, Output>> = render([], "?");
// @ts-expect-error Additional arguments retain their declared types.
render([], 42);
// @ts-expect-error The output's shape is not erased.
const wrong: number = rendered[0].converted.text;

// Existing generic bounds survive the wrapper; the builder does not require an agent.
const identity = defineLower(
  <T extends Input>(messages: T[]): Array<IRConversion<T, T>> =>
    messages.map(original => ({ original, converted: original })),
);
const extra: number = identity([{ role: "note", text: "hi", extra: 42 }])[0].converted.extra;
// @ts-expect-error Generic bounds survive too.
identity([{ role: "something-else", text: "hi" }]);

const trajectoryOutput = (messages: Input[]): Array<IRConversion<Input, Trajectory>> =>
  messages.map(original => ({ original, converted: { role: "subagent-trajectory", ir: [] } }));
// @ts-expect-error A declared trajectory output is forbidden.
defineLower(trajectoryOutput);

const mixedOutput = (messages: Input[]): Array<IRConversion<Input, Output | Trajectory>> =>
  messages.map(original => ({
    original,
    converted: original.text
      ? { role: "rendered-note", text: original.text }
      : { role: "subagent-trajectory", ir: [] },
  }));
// @ts-expect-error A union containing a trajectory is forbidden.
defineLower(mixedOutput);

// Only output roles are restricted by this helper; it imposes no original/output correlation.
defineLower(
  (messages: Trajectory[]): Array<IRConversion<Trajectory, Output>> =>
    messages.map(original => ({ original, converted: { role: "rendered-note", text: "done" } })),
);
