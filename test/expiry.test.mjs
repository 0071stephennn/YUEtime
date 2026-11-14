import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import { expiryForDate, expiryLabel, shiftDate, todayInShanghai } from "../public/dates.js";
import { displaySlots, eventExpiry, eventHours } from "../public/time-zone.js";
import worker from "../worker.mjs";

const initial = await readFile(new URL("../migrations/0001_initial.sql", import.meta.url), "utf8");
const expiry = await readFile(new URL("../migrations/0002_expiry.sql", import.meta.url), "utf8");
const zones = await readFile(new URL("../migrations/0003_time_zone.sql", import.meta.url), "utf8");

test("Beijing midnight defines the last day and expiry", () => {
  assert.equal(todayInShanghai(Date.parse("2026-12-06T15:59:59Z")), "2026-12-06");
  assert.equal(todayInShanghai(Date.parse("2026-12-06T16:00:00Z")), "2026-12-07");
  const expiresAt = expiryForDate("2026-12-31");
  assert.equal(new Date(expiresAt).toISOString(), "2026-12-31T16:00:00.000Z");
  assert.equal(expiryLabel(expiresAt), "2027-01-01 00:00");
});

test("migration backfills the deadline and preserves existing votes", () => {
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec("PRAGMA foreign_keys = ON;");
  sqlite.exec(initial);
  sqlite.prepare("INSERT INTO events VALUES (?, ?, ?, ?, ?)")
    .run("legacy", "Previous event", '["2026-11-30","2026-12-06"]', 9, 23);
  sqlite.prepare("INSERT INTO votes VALUES (?, ?, ?, ?)")
    .run("legacy", "session", "Alex", '["2026-12-06|9"]');
  sqlite.exec(expiry);
  sqlite.exec(zones);
  assert.equal(sqlite.prepare("SELECT time_zone FROM events WHERE id = 'legacy'").get().time_zone, "Asia/Shanghai");
  assert.equal(sqlite.prepare("SELECT expires_at FROM events WHERE id = 'legacy'").get().expires_at,
    expiryForDate("2026-12-06"));
  assert.equal(sqlite.prepare("SELECT count(*) AS n FROM votes").get().n, 1);
  sqlite.close();
});

test("only live, submitted sessions can access results and cleanup is scoped", async t => {
  const sqlite = new DatabaseSync(":memory:");
  t.after(() => sqlite.close());
  sqlite.exec("PRAGMA foreign_keys = ON;");
  sqlite.exec(initial);
  sqlite.exec(expiry);
  sqlite.exec(zones);
  const env = {
    DB: {
      prepare(sql) {
        const query = sqlite.prepare(sql);
        return {
          bind(...values) {
            return {
              run: () => query.run(...values),
              first: () => query.get(...values) ?? null,
              all: () => ({ results: query.all(...values) }),
            };
          },
        };
      },
    },
  };

  async function call(path = "", method = "GET", body, cookie) {
    const headers = { "Content-Type": "application/json" };
    if (cookie) headers.Cookie = cookie;
    return worker.fetch(new Request("https://yuetime.example/api/events" + path, {
      method, headers, body: JSON.stringify(body),
    }), env);
  }

  const now = Date.now();
  const today = todayInShanghai(now);
  const lastDate = shiftDate(today, 6);
  const yesterday = todayInShanghai(now - 86_400_000);
  const eventBody = { title: "Trial", dates: [lastDate, today], startHour: 9, endHour: 23 };
  assert.equal((await call("", "POST", { ...eventBody, dates: [yesterday] })).status, 400);
  assert.equal((await call("", "POST", { ...eventBody, dates: [shiftDate(today, 7), today] })).status, 400);
  const create = await call("", "POST", eventBody);
  assert.equal(create.status, 201);
  const { event } = await create.json();
  assert.deepEqual(event.dates, [today, lastDate]);
  assert.equal(event.expiresAt, expiryForDate(lastDate));
  assert.equal(event.timeZone, "Asia/Shanghai");
  assert.equal(Object.keys(event.slotHours).length, 2);
  const path = "/" + event.id;
  const view = await call(path);
  const voteCookie = view.headers.get("Set-Cookie").split(";")[0];
  assert.equal((await call(path + "/results", "GET", undefined, voteCookie)).status, 403);
  const vote = { name: "Alex", cells: [lastDate + "|9"] };
  assert.equal((await call(path + "/vote", "PUT", { ...vote, cells: [shiftDate(today, 1) + "|9"] }, voteCookie)).status, 400);
  assert.equal((await call(path + "/vote", "PUT", vote, voteCookie)).status, 200);
  const result = await call(path + "/results", "GET", undefined, voteCookie);
  assert.deepEqual((await result.json()).slots[lastDate + "|9"], ["Alex"]);

  const { event: future } = await (await call("", "POST", eventBody)).json();
  const visitor = await call("/" + future.id);
  const futureCookie = visitor.headers.get("Set-Cookie").split(";")[0];
  assert.equal((await call("/" + future.id + "/vote", "PUT", vote, futureCookie)).status, 200);
  sqlite.prepare("UPDATE events SET expires_at = ? WHERE id = ?").run(now, event.id);
  assert.equal((await call(path, "GET", undefined, voteCookie)).status, 410);
  assert.equal((await call(path + "/vote", "PUT", vote, voteCookie)).status, 410);
  assert.equal((await call(path + "/results", "GET", undefined, voteCookie)).status, 410);
  assert.equal(sqlite.prepare("SELECT count(*) AS n FROM votes").get().n, 2);

  await worker.scheduled(null, env);
  assert.equal((await call(path, "GET", undefined, voteCookie)).status, 404);
  const active = await call("/" + future.id + "/results", "GET", undefined, futureCookie);
  assert.equal((await active.json()).total, 1);
  assert.equal(sqlite.prepare("SELECT count(*) AS n FROM events").get().n, 1);
  assert.equal(sqlite.prepare("SELECT count(*) AS n FROM votes").get().n, 1);
  await worker.scheduled(null, env);
  assert.equal(sqlite.prepare("SELECT count(*) AS n FROM events").get().n, 1);
});

test("display time zones can expand seven days to eight without changing vote keys", () => {
  const first = "2027-01-07";
  const dates = Array.from({ length: 7 }, (_, day) => shiftDate(first, day));
  const timeZone = "America/New_York";
  const slotHours = Object.fromEntries(dates.map(date => [date, eventHours(date, 9, 23, timeZone)]));
  const event = { dates, startHour: 9, endHour: 23, timeZone, slotHours };
  const columns = displaySlots(event, "Asia/Kolkata");
  assert.deepEqual([...columns.keys()], Array.from({ length: 8 }, (_, day) => shiftDate(first, day)));
  assert.equal(columns.get("2027-01-08").get("00:30").key, first + "|14");
  const viewKeys = [...columns.values()].flatMap(column => [...column.values()].map(slot => slot.key));
  assert.equal(viewKeys.length, 98);
  assert.equal(new Set(viewKeys).size, 98);
});

test("time-zone rules determine slot instants and expiration", () => {
  const zone = "America/New_York";
  assert.equal(new Date(eventHours("2027-03-13", 9, 10, zone)[0]).toISOString(), "2027-03-13T14:00:00.000Z");
  assert.equal(new Date(eventHours("2027-03-14", 9, 10, zone)[0]).toISOString(), "2027-03-14T13:00:00.000Z");
  assert.equal(eventHours("2027-03-14", 1, 4, zone), null);
  assert.equal(eventHours("2027-11-07", 0, 3, zone), null);
  assert.equal(new Date(eventExpiry("2027-03-14", zone)).toISOString(), "2027-03-15T04:00:00.000Z");
  const date = "2027-11-07";
  const event = { dates: [date], startHour: 4, endHour: 8, slotHours: { [date]: eventHours(date, 4, 8, "UTC") } };
  const repeated = displaySlots(event, zone).get(date);
  assert.equal(repeated.get("01:00").key, date + "|5");
  assert.equal(repeated.get("01:00#2").key, date + "|6");
});
