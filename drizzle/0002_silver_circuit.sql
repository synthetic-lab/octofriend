CREATE TABLE `history_sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`cwd` text NOT NULL,
	`transport_kind` text NOT NULL,
	`launch_command_args_json` text NOT NULL,
	CONSTRAINT "history_sessions_transport_kind_check" CHECK("history_sessions"."transport_kind" IN ('local', 'docker'))
);
--> statement-breakpoint
CREATE INDEX `history_sessions_cwd_updated_at_idx` ON `history_sessions` (`cwd`,`updated_at`);
--> statement-breakpoint
CREATE INDEX `history_sessions_updated_at_idx` ON `history_sessions` (`updated_at`);
--> statement-breakpoint
CREATE TABLE `history_items` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`session_id` text NOT NULL,
	`position` integer NOT NULL,
	`type` text NOT NULL,
	`content` text,
	`llm_ir_json` text,
	FOREIGN KEY (`session_id`) REFERENCES `history_sessions`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `history_items_session_position_idx` ON `history_items` (`session_id`,`position`);
