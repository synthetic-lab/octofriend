CREATE TABLE `previews` (
	`session_id` text PRIMARY KEY NOT NULL,
	`preview` text,
	`preview_type` text NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`session_id`) REFERENCES `trees`(`name`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `trees_cwd_updated_at_idx` ON `trees` (`cwd`,"updated_at" DESC);