CREATE TABLE `annotations` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`target_type` text NOT NULL,
	`target_id` text NOT NULL,
	`quote_text` text,
	`note_text` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `annotations_user_target_idx` ON `annotations` (`user_id`,`target_type`,`target_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `annotations_user_updated_idx` ON `annotations` (`user_id`,`updated_at`);--> statement-breakpoint
CREATE TABLE `collection_items` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`collection_id` text NOT NULL,
	`target_type` text NOT NULL,
	`target_id` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`collection_id`) REFERENCES `collections`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `collection_items_collection_target_unique` ON `collection_items` (`collection_id`,`target_type`,`target_id`);--> statement-breakpoint
CREATE INDEX `collection_items_user_idx` ON `collection_items` (`user_id`,`collection_id`);--> statement-breakpoint
CREATE INDEX `collection_items_user_target_idx` ON `collection_items` (`user_id`,`target_type`,`target_id`);--> statement-breakpoint
CREATE TABLE `collections` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`name` text NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `collections_user_name_unique` ON `collections` (`user_id`,`name`);--> statement-breakpoint
CREATE INDEX `collections_user_updated_idx` ON `collections` (`user_id`,`updated_at`);--> statement-breakpoint
CREATE TABLE `knowledge_states` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`target_type` text NOT NULL,
	`target_id` text NOT NULL,
	`status` text DEFAULT 'inbox' NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `knowledge_states_user_target_unique` ON `knowledge_states` (`user_id`,`target_type`,`target_id`);--> statement-breakpoint
CREATE INDEX `knowledge_states_user_status_idx` ON `knowledge_states` (`user_id`,`status`);