-- Custom SQL file for session tree node triggers --
CREATE TRIGGER `tree_nodes_require_new_leaf`
BEFORE INSERT ON `tree_nodes`
WHEN NEW.`is_leaf` <> 1
BEGIN
	SELECT RAISE(ABORT, 'new tree nodes must be leaves');
END;
--> statement-breakpoint
CREATE TRIGGER `tree_nodes_mark_parent_non_leaf`
AFTER INSERT ON `tree_nodes`
WHEN NEW.`parent_id` IS NOT NULL
BEGIN
	UPDATE `tree_nodes`
	SET `is_leaf` = 0
	WHERE `id` = NEW.`parent_id` AND `tree_id` = NEW.`tree_id`;
END;
--> statement-breakpoint
CREATE TRIGGER `tree_nodes_restore_parent_leaf`
AFTER DELETE ON `tree_nodes`
WHEN OLD.`parent_id` IS NOT NULL
BEGIN
	UPDATE `tree_nodes`
	SET `is_leaf` = NOT EXISTS (
		SELECT 1 FROM `tree_nodes` WHERE `parent_id` = OLD.`parent_id`
	)
	WHERE `id` = OLD.`parent_id` AND `tree_id` = OLD.`tree_id`;
END;
--> statement-breakpoint
CREATE TRIGGER `tree_nodes_identity_immutable`
BEFORE UPDATE OF `history_item_id`, `tree_id`, `parent_id`, `launch_id` ON `tree_nodes`
BEGIN
	SELECT RAISE(ABORT, 'tree node identity is immutable');
END;
--> statement-breakpoint
CREATE TRIGGER `tree_nodes_delete_history_item`
AFTER DELETE ON `tree_nodes`
BEGIN
	DELETE FROM `history_items` WHERE `id` = OLD.`history_item_id`;
END;
--> statement-breakpoint
CREATE TRIGGER `history_items_delete_payloads`
AFTER DELETE ON `history_items`
BEGIN
	DELETE FROM `request_failed_items` WHERE `id` = OLD.`request_failed_id`;
	DELETE FROM `compaction_failed_items` WHERE `id` = OLD.`compaction_failed_id`;
	DELETE FROM `notifications` WHERE `id` = OLD.`notification_id`;
	DELETE FROM `llm_irs` WHERE `id` = OLD.`llm_ir_id`;
END;
