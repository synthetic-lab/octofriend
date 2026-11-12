import type { ExecutionArgs } from "./execution.ts";

export type SystemPrompt<Data, Provider> = (args: ExecutionArgs<Data, Provider>) => Promise<string>;

export type SystemPromptData<P> = P extends SystemPrompt<infer Data, any> ? Data : never;

export class PromptBuilder<Data, Provider> {
  withData<NewData>(): PromptBuilder<Data & NewData, Provider> {
    return new PromptBuilder<Data & NewData, Provider>();
  }

  declare(systemPrompt: SystemPrompt<Data, Provider>): SystemPrompt<Data, Provider> {
    return systemPrompt;
  }
}

export const prompt = new PromptBuilder<{}, unknown>();
