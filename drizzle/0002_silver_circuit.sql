CREATE TABLE `compaction_failed_items` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL
);
--> statement-breakpoint
CREATE TABLE `docker_launches` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`kind` text NOT NULL,
	`container_target` text,
	`docker_run_args_json` text,
	`config` text,
	`unchained` integer NOT NULL,
	CONSTRAINT "docker_launches_unchained_check" CHECK("docker_launches"."unchained" IN (0, 1)),
	CONSTRAINT "docker_launches_kind_args_check" CHECK(("docker_launches"."kind" = 'connect' AND "docker_launches"."container_target" IS NOT NULL AND "docker_launches"."docker_run_args_json" IS NULL)
        OR ("docker_launches"."kind" = 'run' AND "docker_launches"."container_target" IS NULL AND "docker_launches"."docker_run_args_json" IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE `history_items` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`request_failed_id` integer,
	`compaction_failed_id` integer,
	`notification_id` integer,
	`llm_ir_id` integer,
	FOREIGN KEY (`request_failed_id`) REFERENCES `request_failed_items`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`compaction_failed_id`) REFERENCES `compaction_failed_items`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`notification_id`) REFERENCES `notifications`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`llm_ir_id`) REFERENCES `llm_irs`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "history_items_exactly_one_payload_check" CHECK(("history_items"."request_failed_id" IS NOT NULL)
        + ("history_items"."compaction_failed_id" IS NOT NULL)
        + ("history_items"."notification_id" IS NOT NULL)
        + ("history_items"."llm_ir_id" IS NOT NULL) = 1)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `history_items_request_failed_id_unique` ON `history_items` (`request_failed_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `history_items_compaction_failed_id_unique` ON `history_items` (`compaction_failed_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `history_items_notification_id_unique` ON `history_items` (`notification_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `history_items_llm_ir_id_unique` ON `history_items` (`llm_ir_id`);--> statement-breakpoint
CREATE TABLE `launches` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`docker_launch_id` integer,
	`local_launch_id` integer,
	FOREIGN KEY (`docker_launch_id`) REFERENCES `docker_launches`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`local_launch_id`) REFERENCES `local_launches`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "launches_exactly_one_kind_check" CHECK(("launches"."docker_launch_id" IS NOT NULL) <> ("launches"."local_launch_id" IS NOT NULL))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `launches_docker_launch_id_unique` ON `launches` (`docker_launch_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `launches_local_launch_id_unique` ON `launches` (`local_launch_id`);--> statement-breakpoint
CREATE TABLE `llm_irs` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`json` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `local_launches` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`config` text,
	`unchained` integer NOT NULL,
	CONSTRAINT "local_launches_unchained_check" CHECK("local_launches"."unchained" IN (0, 1))
);
--> statement-breakpoint
CREATE TABLE `notifications` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`content` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `request_failed_items` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL
);
--> statement-breakpoint
CREATE TABLE `tree_nodes` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`history_item_id` integer NOT NULL,
	`tree_id` integer NOT NULL,
	`parent_id` integer,
	`is_leaf` integer NOT NULL,
	`launch_id` integer NOT NULL,
	FOREIGN KEY (`history_item_id`) REFERENCES `history_items`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`tree_id`) REFERENCES `trees`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`launch_id`) REFERENCES `launches`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`parent_id`,`tree_id`) REFERENCES `tree_nodes`(`id`,`tree_id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "tree_nodes_not_own_parent_check" CHECK("tree_nodes"."parent_id" IS NULL OR "tree_nodes"."parent_id" <> "tree_nodes"."id"),
	CONSTRAINT "tree_nodes_is_leaf_check" CHECK("tree_nodes"."is_leaf" IN (0, 1))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `tree_nodes_history_item_id_unique` ON `tree_nodes` (`history_item_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `tree_nodes_id_tree_id_unique` ON `tree_nodes` (`id`,`tree_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `tree_nodes_one_root_unique` ON `tree_nodes` (`tree_id`) WHERE "tree_nodes"."parent_id" IS NULL;--> statement-breakpoint
CREATE INDEX `tree_nodes_tree_leaf_id_idx` ON `tree_nodes` (`tree_id`,`is_leaf`,`id`);--> statement-breakpoint
CREATE INDEX `tree_nodes_parent_tree_idx` ON `tree_nodes` (`parent_id`,`tree_id`);--> statement-breakpoint
CREATE TABLE `trees` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`cwd` text NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `trees_name_unique` ON `trees` (`name`);--> statement-breakpoint
CREATE INDEX `trees_cwd_updated_at_idx` ON `trees` (`cwd`,`updated_at`);--> statement-breakpoint
CREATE INDEX `trees_updated_at_idx` ON `trees` (`updated_at`);
