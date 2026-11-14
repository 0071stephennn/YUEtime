CREATE TABLE IF NOT EXISTS events (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  dates TEXT NOT NULL,
  start_hour INTEGER NOT NULL,
  end_hour INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS votes (
  event_id TEXT NOT NULL REFERENCES events(id),
  session_id TEXT NOT NULL,
  name TEXT NOT NULL,
  cells TEXT NOT NULL,
  PRIMARY KEY (event_id, session_id)
);
