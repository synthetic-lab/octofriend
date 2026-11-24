import { t } from "structural";
import { ok } from "../result.ts";
import { ToolBuilder } from "./tool-def.ts";
import type { ToolCallFromToolMap } from "./tool-def.ts";

function expectType<T>(_: T) {}

type Equal<X, Y> =
  (<T>() => T extends X ? 1 : 2) extends <T>() => T extends Y ? 1 : 2 ? true : false;
type Expect<T extends true> = T;

const builder = new ToolBuilder<{ prefix: string }>();
const countSchema = t.subtype({ count: t.num });
const pathSchema = t.subtype({ path: t.str });
const parsedDeclaration = builder.declare({
  name: "parsed",
  description: "Parses a string into a count",
  ArgumentsSchema: t.subtype({ text: t.str }),
  ParsedSchema: countSchema,
});
const parsed = parsedDeclaration
  .withCustomIR({
    note: toolCall => (text: string) => ({ role: "note" as const, toolCall, text }),
  })
  .define(async ({ data }) => {
    expectType<string>(data.prefix);
    // @ts-expect-error Factory data must retain its declared shape.
    data.undeclared;
    return {
      parse: async ({ original }) => {
        expectType<string>(original.text);
        return ok({ original, parsed: { count: original.text.length } });
      },
      validate: async (_signal, _transport, call, data) => {
        expectType<string>(call.original.arguments.text);
        expectType<number>(call.parsed.arguments.count);
        expectType<string>(data.prefix);
        return ok(null);
      },
      run: async ({ toolCall, data, customIR }) => {
        expectType<number>(toolCall.parsed.arguments.count);
        expectType<string>(data.prefix);
        // @ts-expect-error Parsed arguments must not become the original arguments or any.
        toolCall.parsed.arguments.text;
        // @ts-expect-error Custom IR builders must retain their parameter types.
        customIR.note(42);
        return customIR.note(data.prefix);
      },
    };
  });

// @ts-expect-error Different parsed arguments require an explicit parser.
parsedDeclaration.define(async () => ({ run: async () => ok({ type: "output", content: [] }) }));

const automatic = builder
  .declare({
    name: "automatic",
    description: "Uses arguments without parsing",
    ArgumentsSchema: pathSchema,
  })
  .define(async () => ({
    run: async ({ toolCall, data }) => {
      expectType<string>(toolCall.original.arguments.path);
      expectType<string>(toolCall.parsed.arguments.path);
      expectType<string>(data.prefix);
      return ok({ type: "output", content: [] });
    },
  }));

const unavailable = parsedDeclaration.define(async () => null);
const dynamic = builder.dynamicDefineTool(async () => parsed);
type Calls = ToolCallFromToolMap<{
  parsed: typeof parsed;
  automatic: typeof automatic;
  dynamic: typeof dynamic;
}>;
type _names = Expect<Equal<Calls["name"], "parsed" | "automatic">>;
type _parsed = Expect<
  Equal<Extract<Calls, { name: "parsed" }>["parsed"], t.GetType<typeof countSchema>>
>;
type _automatic = Expect<
  Equal<Extract<Calls, { name: "automatic" }>["parsed"], t.GetType<typeof pathSchema>>
>;
type _unavailable = Expect<
  Equal<
    ToolCallFromToolMap<{ parsed: typeof unavailable }>["parsed"],
    t.GetType<typeof countSchema>
  >
>;
