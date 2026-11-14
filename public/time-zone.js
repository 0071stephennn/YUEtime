import { shiftDate } from "./dates.js";

export const defaultZone = "Asia/Shanghai";
const hourMs = 3_600_000;
const formatters = new Map();

function formatter(timeZone) {
  if (!formatters.has(timeZone)) {
    formatters.set(timeZone, new Intl.DateTimeFormat("sv-SE", {
      timeZone, year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23",
    }));
  }
  return formatters.get(timeZone);
}

export function validTimeZone(value) {
  if (typeof value !== "string" || !/^[A-Za-z][A-Za-z0-9_+/-]{0,79}$/.test(value)) return false;
  try {
    new Intl.DateTimeFormat("en", { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

export function localTime(instant, zone) {
  const parts = Object.fromEntries(formatter(zone).formatToParts(instant).map(({ type, value }) => [type, value]));
  return {
    date: parts.year.padStart(4, "0") + "-" + parts.month + "-" + parts.day,
    time: parts.hour + ":" + parts.minute,
    seconds: parts.second,
  };
}

function offsetsForDate(date, zone) {
  const midnight = Date.parse(date);
  const offsets = new Set();
  for (let hour = -36; hour <= 60; hour += 12) {
    const instant = midnight + hour * hourMs;
    const local = localTime(instant, zone);
    offsets.add(Date.parse(local.date + "T" + local.time + ":" + local.seconds + "Z") - instant);
  }
  return offsets;
}

function instantsAt(wall, offsets, zone) {
  return [...offsets].map(offset => wall - offset).filter(instant => {
    const local = localTime(instant, zone);
    return Date.parse(local.date + "T" + local.time + ":" + local.seconds + "Z") === wall;
  }).sort((a, b) => a - b);
}

export function eventHours(date, startHour, endHour, zone) {
  const midnight = Date.parse(date);
  const offsets = offsetsForDate(date, zone);
  const hours = [];
  for (let hour = startHour; hour <= endHour; hour++) {
    const instants = instantsAt(midnight + hour * hourMs, offsets, zone);
    if (instants.length !== 1) return null;
    if (hours.length && instants[0] - hours.at(-1) !== hourMs) return null;
    hours.push(instants[0]);
  }
  return hours;
}

export function eventExpiry(date, zone) {
  const next = shiftDate(date, 1);
  const midnight = Date.parse(next);
  const offsets = offsetsForDate(next, zone);
  const exact = instantsAt(midnight, offsets, zone);
  if (exact.length) return exact[0];

  let before = midnight - 36 * hourMs;
  let after = midnight + 36 * hourMs;
  while (after - before > 1000) {
    const middle = Math.floor((before + after) / 2000) * 1000;
    if (localTime(middle, zone).date < next) before = middle;
    else after = middle;
  }
  return after;
}

export function displaySlots(event, zone) {
  const columns = new Map();
  for (const date of event.dates) {
    const hours = event.slotHours?.[date] ?? eventHours(date, event.startHour, event.endHour, defaultZone);
    for (let index = 0; index < hours.length - 1; index++) {
      const start = localTime(hours[index], zone);
      if (!columns.has(start.date)) columns.set(start.date, new Map());
      const column = columns.get(start.date);
      let row = start.time;
      for (let occurrence = 2; column.has(row); occurrence++) row = start.time + "#" + occurrence;
      column.set(row, { key: date + "|" + (event.startHour + index), start: hours[index], end: hours[index + 1] });
    }
  }
  return columns;
}
