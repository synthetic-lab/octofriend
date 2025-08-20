CREATE TABLE `input_history` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`created_at` integer NOT NULL,
	`input` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `createdAt_idx` ON `input_history` (`created_at`);