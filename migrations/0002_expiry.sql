ALTER TABLE events ADD COLUMN expires_at INTEGER NOT NULL DEFAULT 0;

-- Existing candidate dates are stored as validated YYYY-MM-DD strings.
UPDATE events
SET expires_at = (
  SELECT unixepoch(max(value) || 'T00:00:00+08:00') * 1000 + 86400000
  FROM json_each(events.dates)
);

CREATE INDEX events_by_expiry ON events(expires_at);

CREATE TRIGGER delete_event_votes BEFORE DELETE ON events
BEGIN
  DELETE FROM votes WHERE event_id = OLD.id;
END;
