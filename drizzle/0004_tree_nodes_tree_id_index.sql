CREATE INDEX `tree_nodes_tree_id_idx` ON `tree_nodes` (`tree_id`);
--> statement-breakpoint
ALTER TABLE `tree_nodes` ADD `created_at` integer NOT NULL;