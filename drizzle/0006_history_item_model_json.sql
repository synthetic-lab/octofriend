ALTER TABLE `history_items` ADD `model_json` text;
--> statement-breakpoint
UPDATE `history_items`
SET `model_json` = 'octo-no-model-recorded'
WHERE `model_json` IS NULL;
--> statement-breakpoint
-- Enforce NOT NULL via a table rebuild: `ALTER ... SET NOT NULL` requires
-- SQLite >= 3.50, but macOS ships older SQLite builds.
PRAGMA defer_foreign_keys = ON;
--> statement-breakpoint
CREATE TABLE `__new_history_items` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`request_failed_id` integer,
	`compaction_failed_id` integer,
	`notification_id` integer,
	`llm_ir_id` integer,
	`model_json` text NOT NULL,
	FOREIGN KEY (`request_failed_id`) REFERENCES `request_failed_items`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`compaction_failed_id`) REFERENCES `compaction_failed_items`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`notification_id`) REFERENCES `notifications`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`llm_ir_id`) REFERENCES `llm_irs`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "history_items_exactly_one_payload_check" CHECK(("request_failed_id" IS NOT NULL)
        + ("compaction_failed_id" IS NOT NULL)
        + ("notification_id" IS NOT NULL)
        + ("llm_ir_id" IS NOT NULL) = 1)
);
--> statement-breakpoint
INSERT INTO `__new_history_items`
SELECT `id`, `request_failed_id`, `compaction_failed_id`, `notification_id`, `llm_ir_id`, `model_json`
FROM `history_items`;
--> statement-breakpoint
DROP TABLE `history_items`;
--> statement-breakpoint
PRAGMA legacy_alter_table = ON;
--> statement-breakpoint
ALTER TABLE `__new_history_items` RENAME TO `history_items`;
--> statement-breakpoint
PRAGMA legacy_alter_table = OFF;
--> statement-breakpoint
CREATE UNIQUE INDEX `history_items_requestFailedId_unique` ON `history_items` (`request_failed_id`);
--> statement-breakpoint
CREATE UNIQUE INDEX `history_items_compactionFailedId_unique` ON `history_items` (`compaction_failed_id`);
--> statement-breakpoint
CREATE UNIQUE INDEX `history_items_notificationId_unique` ON `history_items` (`notification_id`);
--> statement-breakpoint
CREATE UNIQUE INDEX `history_items_llmIrId_unique` ON `history_items` (`llm_ir_id`);
--> statement-breakpoint
CREATE TRIGGER `history_items_delete_payloads`
AFTER DELETE ON `history_items`
BEGIN
	DELETE FROM `request_failed_items` WHERE `id` = OLD.`request_failed_id`;
	DELETE FROM `compaction_failed_items` WHERE `id` = OLD.`compaction_failed_id`;
	DELETE FROM `notifications` WHERE `id` = OLD.`notification_id`;
	DELETE FROM `llm_irs` WHERE `id` = OLD.`llm_ir_id`;
END;
