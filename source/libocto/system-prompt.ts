import type { ExecutionArgs } from "./execution.ts";

export type SystemPrompt<Data> = (args: ExecutionArgs<Data>) => Promise<string>;

export type SystemPromptData<P> = P extends SystemPrompt<infer Data> ? Data : never;

export class PromptBuilder<Data> {
  withData<NewData>(): PromptBuilder<Data & NewData> {
    return new PromptBuilder<Data & NewData>();
  }

  declare(systemPrompt: SystemPrompt<Data>): SystemPrompt<Data> {
    return systemPrompt;
  }
}

export const prompt = new PromptBuilder<{}>();
