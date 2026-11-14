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
  return new Date(Date.parse(date) + days * day).toISOString().slice(0, 10);
}

export function daysBetween(first, last) {
  return (Date.parse(last) - Date.parse(first)) / day;
}

export function calendarDates(month) {
  const first = month + "-01";
  const weekday = new Date(first).getUTCDay();
  const offset = (weekday + 6) % 7;
  return Array.from({ length: 42 }, (_, index) => shiftDate(first, index - offset));
}
