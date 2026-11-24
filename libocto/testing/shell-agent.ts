import type { Agent } from "../source/llm-ir.ts";
import type { toolkit } from "../source/toolkits/shell/index.ts";

export type ShellAgent = Agent<never, {}, { shell: typeof toolkit }, {}>;
