ALTER TABLE events ADD COLUMN time_zone TEXT NOT NULL DEFAULT 'Asia/Shanghai';
ALTER TABLE events ADD COLUMN slot_hours TEXT;
