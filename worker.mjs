import { daysBetween, maxDateSpan } from "./public/dates.js";
import { defaultZone, eventExpiry, eventHours, localTime, validTimeZone } from "./public/time-zone.js";
import { messages } from "./public/messages.js";

const eventIdPattern = /^[0-9a-f-]{36}$/;
const uuidPattern = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/;

class RequestError extends Error {
  constructor(code, status = 400) {
    super(messages.zh[code]);
    this.code = code;
    this.status = status;
  }
}

function expiredEvent() {
  return new RequestError("expired", 410);
}

function checkExpiry(event) {
  if (Date.now() >= event.expiresAt) throw expiredEvent();
}

function json(data, status = 200, headers = {}) {
  return Response.json(data, {
    status,
    headers: { "Cache-Control": "no-store", ...headers },
  });
}

async function readBody(request) {
  if (!request.headers.get("Content-Type")?.startsWith("application/json")) {
    throw new RequestError("jsonType", 415);
  }
  try {
    const body = await request.json();
    if (body && typeof body === "object" && !Array.isArray(body)) return body;
  } catch {
    // Return the same validation error for malformed JSON.
  }
  throw new RequestError("badJson");
}

function isDate(date) {
  if (typeof date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return false;
  const parsed = new Date(date);
  return Number.isFinite(+parsed) && parsed.toISOString().slice(0, 10) === date;
}

function cleanText(value, max, error) {
  const text = typeof value === "string" ? value.trim() : "";
  if (!text || text.length > max) throw new RequestError(error);
  return text;
}

async function createEvent(request, db) {
  const body = await readBody(request);
  const title = cleanText(body.title, 80, "badTitle");
  const { dates, startHour, endHour, timeZone = defaultZone } = body;
  if (!validTimeZone(timeZone)) throw new RequestError("badZone");
  if (!Array.isArray(dates) || dates.length < 1 || dates.length > maxDateSpan ||
      !dates.every(isDate) || new Set(dates).size !== dates.length) {
    throw new RequestError("badDates");
  }
  if (!Number.isInteger(startHour) || !Number.isInteger(endHour) ||
      startHour < 0 || endHour > 24 || startHour >= endHour) {
    throw new RequestError("badHours");
  }
  dates.sort();
  if (dates[0] < localTime(Date.now(), timeZone).date) throw new RequestError("pastDate");
  if (daysBetween(dates[0], dates.at(-1)) >= maxDateSpan) {
    throw new RequestError("spanLimit");
  }
  const slotHours = {};
  for (const date of dates) {
    const hours = eventHours(date, startHour, endHour, timeZone);
    if (!hours) throw new RequestError("clockChange");
    slotHours[date] = hours;
  }
  const expiresAt = eventExpiry(dates.at(-1), timeZone);
  const event = { id: crypto.randomUUID(), title, dates, startHour, endHour, expiresAt, timeZone, slotHours };
  await db.prepare(`
    INSERT INTO events (id, title, dates, start_hour, end_hour, expires_at, time_zone, slot_hours)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(event.id, title, JSON.stringify(dates), startHour, endHour, expiresAt, timeZone,
    JSON.stringify(slotHours)).run();
  return json({ event }, 201);
}

async function getEvent(db, id) {
  const row = await db.prepare("SELECT * FROM events WHERE id = ?").bind(id).first();
  if (!row) throw new RequestError("missingEvent", 404);
  const event = {
    id: row.id, title: row.title, dates: JSON.parse(row.dates),
    startHour: row.start_hour, endHour: row.end_hour, expiresAt: row.expires_at,
    timeZone: row.time_zone, slotHours: row.slot_hours ? JSON.parse(row.slot_hours) : null,
  };
  checkExpiry(event);
  return event;
}

function getSession(request, event, create = false) {
  const name = "yuetime_" + event.id;
  const cookie = (request.headers.get("Cookie") || "").split(";")
    .map(part => part.trim()).find(part => part.startsWith(name + "="));
  const existing = cookie?.slice(name.length + 1) || "";
  if (uuidPattern.test(existing)) return { id: existing, headers: {} };
  if (!create) return { id: "", headers: {} };
  const id = crypto.randomUUID();
  const secure = new URL(request.url).protocol === "https:" ? "; Secure" : "";
  const value = name + "=" + id + "; Path=/api/events/" + event.id;
  const seconds = Math.max(1, Math.ceil((event.expiresAt - Date.now()) / 1000));
  // Browsers cap cookie lifetimes even when an event is scheduled farther in advance.
  const maxAge = Math.min(seconds, 31_536_000);
  return { id, headers: { "Set-Cookie": value + "; HttpOnly; SameSite=Lax; Max-Age=" + maxAge + secure } };
}

async function getVote(db, event, session) {
  if (!session.id) return null;
  const row = await db.prepare("SELECT name, cells FROM votes WHERE event_id = ? AND session_id = ?")
    .bind(event.id, session.id).first();
  return row && { name: row.name, cells: JSON.parse(row.cells) };
}

function eventCells(event) {
  return event.dates.flatMap(date => Array.from(
    { length: event.endHour - event.startHour }, (_, index) => date + "|" + (event.startHour + index),
  ));
}

async function saveVote(request, db, event, session) {
  if (!session.id) throw new RequestError("noSession", 403);
  const body = await readBody(request);
  const name = cleanText(body.name, 40, "badName");
  const valid = new Set(eventCells(event));
  if (!Array.isArray(body.cells) || body.cells.length > valid.size ||
      !body.cells.every(cell => valid.has(cell))) {
    throw new RequestError("badCells");
  }
  const cells = [...new Set(body.cells)];
  checkExpiry(event);
  const saved = await db.prepare(`
    INSERT INTO votes (event_id, session_id, name, cells)
    SELECT id, ?, ?, ? FROM events WHERE id = ? AND expires_at > unixepoch('now') * 1000
    ON CONFLICT (event_id, session_id) DO UPDATE SET name = excluded.name, cells = excluded.cells
    RETURNING event_id
  `).bind(session.id, name, JSON.stringify(cells), event.id).first();
  if (!saved) throw expiredEvent();
  return json({ vote: { name, cells } });
}

async function results(db, event, session) {
  if (!await getVote(db, event, session)) {
    throw new RequestError("voteFirst", 403);
  }
  const { results: votes } = await db.prepare(
    "SELECT name, cells FROM votes WHERE event_id = ? ORDER BY rowid",
  ).bind(event.id).all();
  const nameTotals = new Map();
  for (const { name } of votes) nameTotals.set(name, (nameTotals.get(name) || 0) + 1);
  const nameIndexes = new Map();
  const slots = Object.fromEntries(eventCells(event).map(cell => [cell, []]));
  for (const vote of votes) {
    const index = (nameIndexes.get(vote.name) || 0) + 1;
    nameIndexes.set(vote.name, index);
    const name = nameTotals.get(vote.name) > 1 ? vote.name + "（" + index + "）" : vote.name;
    for (const cell of JSON.parse(vote.cells)) slots[cell].push(name);
  }
  checkExpiry(event);
  return json({ total: votes.length, slots });
}

export default {
  async scheduled(_controller, env) {
    await env.DB.prepare("DELETE FROM events WHERE expires_at <= ?").bind(Date.now()).run();
  },

  async fetch(request, env) {
    const url = new URL(request.url);
    if (!url.pathname.startsWith("/api/")) return env.ASSETS.fetch(request);
    try {
      const parts = url.pathname.split("/");
      if (request.method !== "GET") {
        const origin = request.headers.get("Origin");
        if (origin && origin !== url.origin) throw new RequestError("badOrigin", 403);
      }
      if (url.pathname === "/api/events" && request.method === "POST") {
        return await createEvent(request, env.DB);
      }
      if (parts[2] !== "events" || !eventIdPattern.test(parts[3] || "") ||
          parts.length > 5 || (parts[4] && !["vote", "results"].includes(parts[4]))) {
        throw new RequestError("missingPage", 404);
      }
      const event = await getEvent(env.DB, parts[3]);
      const session = getSession(request, event, !parts[4] && request.method === "GET");
      if (!parts[4] && request.method === "GET") {
        const vote = await getVote(env.DB, event, session);
        checkExpiry(event);
        return json({ event, vote }, 200, session.headers);
      }
      if (parts[4] === "vote" && request.method === "PUT") {
        return await saveVote(request, env.DB, event, session);
      }
      if (parts[4] === "results" && request.method === "GET") {
        return await results(env.DB, event, session);
      }
      throw new RequestError("badMethod", 405);
    } catch (error) {
      if (error instanceof RequestError) return json({ error: error.message, code: error.code }, error.status);
      console.error(error);
      return json({ error: messages.zh.serverError, code: "serverError" }, 500);
    }
  },
};
