-- Phase 2 — Plan 02-03 (D-09)
-- Add active_hook_token column for workflow hook resumption.
-- Staff API endpoints read this column to know which token to pass to resumeHook.
-- Tokens are phase-specific (D-08): reservation:<id>:waiting,
-- reservation:<id>:called:pre, reservation:<id>:called:final.
-- Idempotent: ADD COLUMN IF NOT EXISTS allows safe re-application.
-- No backfill needed — reservations table is empty at end of Phase 1.

ALTER TABLE reservations ADD COLUMN IF NOT EXISTS active_hook_token TEXT NULL;
