import type { Metadata } from "../internal/configuration/metadata.ts";
import type { Config } from "../internal/configuration/schemas.ts";
import type { HistoryItem } from "../internal/conversation-history/main.ts";
import type { OctoIR } from "../internal/octo-agent-ir/main.ts";

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
