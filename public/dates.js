const day = 86_400_000;
export const maxDateSpan = 7;
const shanghaiDate = new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Shanghai" });

export function todayInShanghai(now = Date.now()) {
  return shanghaiDate.format(now);
}

export function expiryForDate(date) {
  return Date.parse(date + "T00:00:00+08:00") + day;
}

export function expiryLabel(expiresAt) {
  return shanghaiDate.format(expiresAt) + " 00:00";
}

export function shiftDate(date, days) {
  return new Date(Date.parse(date) + days * day).toISOString().split("T")[0];
}

export function daysBetween(first, last) {
  return (Date.parse(last) - Date.parse(first)) / day;
}

export function pollWeek(first, last) {
  const midpoint = Math.floor(daysBetween(first, last) / 2);
  const halfWeek = Math.floor(maxDateSpan / 2);
  return Array.from({ length: maxDateSpan }, (_, index) =>
    shiftDate(first, midpoint - halfWeek + index));
}

export function calendarDates(month) {
  const first = month + "-01";
  const weekday = new Date(first).getUTCDay();
  const offset = (weekday + 6) % 7;
  return Array.from({ length: 42 }, (_, index) => shiftDate(first, index - offset));
}
