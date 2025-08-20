CREATE TABLE `input_history` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`timestamp` integer NOT NULL,
	`input` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `timestamp_idx` ON `input_history` (`timestamp`);