import type { OctoIR } from "./ir/octo-ir.ts";

export type LlmIRItem = {
  type: "llm-ir";
  ir: OctoIR;
};

export type RequestFailed = {
  type: "request-failed";
};

export type CompactionFailed = {
  type: "compaction-failed";
};

export type Notification = {
  type: "notification";
  content: string;
};

export type HistoryItem = LlmIRItem | RequestFailed | CompactionFailed | Notification;
