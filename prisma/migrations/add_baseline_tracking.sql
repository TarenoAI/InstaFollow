-- Migration: Add baseline tracking fields
-- Datum: 2026-02-08

-- Neue Spalten für Baseline-Tracking
ALTER TABLE MonitoredProfile ADD COLUMN baselineCreatedAt TEXT;
ALTER TABLE MonitoredProfile ADD COLUMN baselineFollowingCount INTEGER;
