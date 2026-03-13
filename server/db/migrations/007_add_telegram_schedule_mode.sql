-- Add 'telegram' to the schedule_mode CHECK constraint
ALTER TABLE auto_post_settings DROP CONSTRAINT IF EXISTS auto_post_settings_schedule_mode_check;
ALTER TABLE auto_post_settings ADD CONSTRAINT auto_post_settings_schedule_mode_check
  CHECK(schedule_mode IN ('scheduled', 'immediate', 'draft', 'telegram'));
