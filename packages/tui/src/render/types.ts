import type { Metadata } from "../runtime/config/metadata";
import type { Config } from "../runtime/config/schemas";
import type { HistoryItem } from "../runtime/history/main";
import type { OctoIR } from "../runtime/agent/ir/main";

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
