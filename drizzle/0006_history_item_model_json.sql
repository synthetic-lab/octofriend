ALTER TABLE `history_items` ADD `model_json` text;
--> statement-breakpoint
UPDATE `history_items`
SET `model_json` = 'octo-no-model-recorded'
WHERE `model_json` IS NULL;
--> statement-breakpoint
ALTER TABLE `history_items` ALTER `model_json` SET NOT NULL;
