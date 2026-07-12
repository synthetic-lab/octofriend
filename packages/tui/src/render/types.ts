import type { OctoIR } from "../runtime/agent/ir/main.ts";
import type { Metadata } from "../runtime/config/metadata.ts";
import type { Config } from "../runtime/config/schemas.ts";
import type { HistoryItem } from "../runtime/history/main.ts";

export type AssistantDisplayItem = {
	content: string;
	reasoningContent?: string | null;
};

export type StaticItem =
	| {
			type: "header";
	  }
	| {
			type: "version";
			metadata: Metadata;
			config: Config;
	  }
	| {
			type: "updates";
			updates: string;
	  }
	| {
			type: "slogan";
	  }
	| {
			type: "history-item";
			item: HistoryItem<OctoIR>;
	  }
	| {
			type: "boot-notification";
			content: string;
	  };
