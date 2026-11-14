CREATE INDEX "character_sessions_started_idx" ON "character_sessions" USING btree ("started_at");--> statement-breakpoint
CREATE INDEX "character_snapshots_captured_idx" ON "character_snapshots" USING btree ("captured_at");--> statement-breakpoint
CREATE INDEX "character_snapshots_sync_run_idx" ON "character_snapshots" USING btree ("sync_run_id");--> statement-breakpoint
CREATE INDEX "economy_audits_run_idx" ON "economy_audits" USING btree ("run_id");--> statement-breakpoint
CREATE INDEX "market_imports_sync_run_idx" ON "market_imports" USING btree ("sync_run_id");--> statement-breakpoint
CREATE INDEX "market_item_latest_import_idx" ON "market_item_latest" USING btree ("import_id");--> statement-breakpoint
CREATE INDEX "opportunity_runs_last_import_idx" ON "opportunity_runs" USING btree ("last_import_id");--> statement-breakpoint
CREATE INDEX "sync_errors_sync_run_idx" ON "sync_errors" USING btree ("sync_run_id");--> statement-breakpoint
CREATE INDEX "sync_runs_started_idx" ON "sync_runs" USING btree ("started_at");