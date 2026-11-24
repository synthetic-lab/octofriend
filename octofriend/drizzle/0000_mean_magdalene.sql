CREATE TABLE `shown_update_notifs` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`update` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `update_idx` ON `shown_update_notifs` (`update`);