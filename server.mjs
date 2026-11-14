import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";
import { Readable } from "node:stream";
import worker from "./worker.mjs";
import { expiryForDate, todayInShanghai } from "./public/dates.js";

const databasePath = process.env.YUETIME_DB || fileURLToPath(new URL("./yuetime.sqlite", import.meta.url));
const sqlite = new DatabaseSync(databasePath);
sqlite.exec("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;");
sqlite.exec(await readFile(new URL("./migrations/0001_initial.sql", import.meta.url), "utf8"));
const migration = await readFile(new URL("./migrations/0002_expiry.sql", import.meta.url), "utf8");
sqlite.exec("BEGIN IMMEDIATE;");
try {
  if (!sqlite.prepare("SELECT name FROM pragma_table_info('events') WHERE name = 'expires_at'").get()) {
    sqlite.exec(migration);
  }
  sqlite.exec("COMMIT;");
} catch (error) {
  sqlite.exec("ROLLBACK;");
  throw error;
}

const DB = {
  prepare(sql) {
    const statement = sqlite.prepare(sql);
    return {
      bind(...values) {
        return {
          run: () => statement.run(...values),
          first: () => statement.get(...values) ?? null,
          all: () => ({ results: statement.all(...values) }),
        };
      },
    };
  },
};

async function cleanUpExpiredEvents() {
  await worker.scheduled(null, { DB });
}

await cleanUpExpiredEvents();
function scheduleCleanup() {
  const now = Date.now();
  const delay = expiryForDate(todayInShanghai(now)) - now;
  setTimeout(async () => {
    try {
      await cleanUpExpiredEvents();
    } catch (error) {
      console.error(error);
    } finally {
      scheduleCleanup();
    }
  }, delay).unref();
}
scheduleCleanup();

const assets = new Map([
  ["/", ["index.html", "text/html"]],
  ["/app.js", ["app.js", "text/javascript"]],
  ["/dates.js", ["dates.js", "text/javascript"]],
  ["/drag-select.js", ["drag-select.js", "text/javascript"]],
  ["/style.css", ["style.css", "text/css"]],
]);

const ASSETS = {
  async fetch(request) {
    const asset = assets.get(new URL(request.url).pathname);
    if (!asset) return new Response("Not found", { status: 404 });
    const [file, type] = asset;
    const contents = await readFile(new URL("./public/" + file, import.meta.url));
    return new Response(contents, { headers: { "Content-Type": type + "; charset=utf-8" } });
  },
};

const host = process.env.YUETIME_HOST || "127.0.0.1";
const port = Number(process.env.YUETIME_PORT || 8787);
createServer(async (incoming, outgoing) => {
  try {
    const init = { method: incoming.method, headers: incoming.headers };
    if (incoming.method !== "GET" && incoming.method !== "HEAD") {
      init.body = Readable.toWeb(incoming);
      init.duplex = "half";
    }
    const origin = "http://" + (incoming.headers.host || ("localhost:" + port));
    const request = new Request(new URL(incoming.url, origin), init);
    const response = await worker.fetch(request, { DB, ASSETS });
    outgoing.writeHead(response.status, Object.fromEntries(response.headers));
    if (response.body && incoming.method !== "HEAD") {
      Readable.fromWeb(response.body).pipe(outgoing);
    } else outgoing.end();
  } catch (error) {
    console.error(error);
    if (!outgoing.headersSent) outgoing.writeHead(500);
    outgoing.end();
  }
}).listen(port, host, () => console.log("约时间  http://" + host + ":" + port + "/"));
