-- Migration 0003: add reopen_count to reservations
-- Idempotent: ADD COLUMN IF NOT EXISTS is safe to re-run
ALTER TABLE reservations
  ADD COLUMN IF NOT EXISTS reopen_count INTEGER NOT NULL DEFAULT 0;
