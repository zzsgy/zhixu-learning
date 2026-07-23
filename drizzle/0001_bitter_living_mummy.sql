CREATE TABLE `articles` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`url` text NOT NULL,
	`source_type` text DEFAULT 'web' NOT NULL,
	`title` text NOT NULL,
	`summary` text NOT NULL,
	`domain` text NOT NULL,
	`author` text,
	`published_at` text,
	`cover_image_url` text,
	`content_html` text NOT NULL,
	`content_text` text NOT NULL,
	`word_count` integer DEFAULT 0 NOT NULL,
	`tags_json` text DEFAULT '[]' NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `articles_user_url_unique` ON `articles` (`user_id`,`url`);--> statement-breakpoint
CREATE INDEX `articles_user_updated_idx` ON `articles` (`user_id`,`updated_at`);--> statement-breakpoint
CREATE INDEX `articles_user_domain_idx` ON `articles` (`user_id`,`domain`);