const day = 86_400_000;
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
