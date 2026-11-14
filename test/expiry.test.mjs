import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import { expiryForDate, expiryLabel, todayInShanghai } from "../public/dates.js";
import worker from "../worker.mjs";

const initial = await readFile(new URL("../migrations/0001_initial.sql", import.meta.url), "utf8");
const expiry = await readFile(new URL("../migrations/0002_expiry.sql", import.meta.url), "utf8");

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
  const tomorrow = todayInShanghai(now + 86_400_000);
  const yesterday = todayInShanghai(now - 86_400_000);
  const eventBody = { title: "Trial", dates: [tomorrow, today], startHour: 9, endHour: 23 };
  assert.equal((await call("", "POST", { ...eventBody, dates: [yesterday] })).status, 400);
  const create = await call("", "POST", eventBody);
  assert.equal(create.status, 201);
  const { event } = await create.json();
  assert.deepEqual(event.dates, [today, tomorrow]);
  assert.equal(event.expiresAt, expiryForDate(tomorrow));
  const path = "/" + event.id;
  const view = await call(path);
  const voteCookie = view.headers.get("Set-Cookie").split(";")[0];
  assert.equal((await call(path + "/results", "GET", undefined, voteCookie)).status, 403);
  const vote = { name: "Alex", cells: [tomorrow + "|9"] };
  assert.equal((await call(path + "/vote", "PUT", vote, voteCookie)).status, 200);
  const result = await call(path + "/results", "GET", undefined, voteCookie);
  assert.deepEqual((await result.json()).slots[tomorrow + "|9"], ["Alex"]);

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
