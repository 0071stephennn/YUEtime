import { calendarDates, daysBetween, maxDateSpan, pollWeek, shiftDate } from "./dates.js";
import { bindDragSelection } from "./drag-select.js";
import { bindLanguages, locale, preference, t } from "./i18n.js";
import { defaultZone, displaySlots, eventExpiry, localTime, validTimeZone } from "./time-zone.js";

const app = document.querySelector("#app");
const home = document.querySelector("#home-link");
const eventId = new URL(location.href).searchParams.get("e");
const dateFormatter = new Intl.DateTimeFormat(locale, {
  month: "numeric", day: "numeric", timeZone: "UTC",
});
const weekdayFormatter = new Intl.DateTimeFormat(locale, { weekday: "short", timeZone: "UTC" });
const monthFormatter = new Intl.DateTimeFormat(locale, { year: "numeric", month: "long", timeZone: "UTC" });
const browserZone = Intl.DateTimeFormat().resolvedOptions().timeZone || defaultZone;
let event;
let displayZone;
let displayedSlots;
let slotFormatter;
let vote;
let chosen = new Set();
let draftName = "";
let justCreated = false;

const escape = value => String(value).replace(/[&<>"']/g, character => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
})[character]);
const hourText = hour => String(hour).padStart(2, "0") + ":00";
const dateText = date => dateFormatter.format(new Date(date));
const weekday = date => weekdayFormatter.format(new Date(date));
const dateLabel = date => dateText(date) + " " + weekday(date);

const arrow = '<span aria-hidden="true">→</span>';
const heatIcon = '<span class="mini-grid" aria-hidden="true"><i></i><i></i><i></i><i></i></span>';
const linkIcon = '<svg aria-hidden="true" width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><path d="M10 13a4 4 0 0 0 6 .5l4-4a4 4 0 0 0-6-5.5L12 6m0 6a4 4 0 0 0-6-.5l-4 4a4 4 0 0 0 6 5.5l2-2" stroke-linecap="round" stroke-linejoin="round"/></svg>';
const refreshIcon = '<span class="refresh-icon" aria-hidden="true">↻</span>';

document.documentElement.lang = locale;
document.title = t("brand");
document.querySelector("#brand-text").textContent = t("brand");
document.querySelector(".site-header nav").setAttribute("aria-label", t("navigation"));
home.lastChild.textContent = " " + t("create");
app.querySelector("[role=status]").textContent = t("loading");
bindLanguages(document.querySelector("#languages"));

function dateTime(instant, timeZone) {
  return new Intl.DateTimeFormat(locale, { timeZone, dateStyle: "medium", timeStyle: "short" }).format(instant);
}

const zones = ["UTC", ...(Intl.supportedValuesOf?.("timeZone") || [])];
function bindZonePicker(label, selected, suggested, change) {
  const trigger = app.querySelector("#zone-picker");
  trigger.textContent = label + " · " + selected;
  trigger.onclick = () => {
    const dialog = document.createElement("dialog");
    dialog.className = "vote-guide zone-dialog";
    dialog.setAttribute("aria-labelledby", "zone-dialog-title");
    dialog.innerHTML = `<form method="dialog"><button class="guide-close" aria-label="${t("closeGuide")}">×</button></form>
      <h2 id="zone-dialog-title">${label}</h2>
      <input type="search" aria-label="${t("findZone")}" placeholder="${t("findZone")}" autofocus>
      <div class="zone-options"></div>`;
    const input = dialog.querySelector("input");
    const options = dialog.querySelector(".zone-options");
    function showZones() {
      const query = input.value.trim().toLowerCase().replaceAll(" ", "_");
      const matching = query
        ? zones.filter(zone => zone.toLowerCase().includes(query))
        : [selected, ...suggested, browserZone, defaultZone, "UTC", "America/New_York", "Europe/Paris", "Asia/Tokyo"];
      if (query && validTimeZone(input.value.trim())) matching.unshift(input.value.trim());
      options.replaceChildren();
      for (const zone of [...new Set(matching)].slice(0, 9)) {
        const button = document.createElement("button");
        button.type = "button";
        button.className = "button secondary compact";
        button.textContent = zone;
        button.setAttribute("aria-pressed", zone === selected);
        button.onclick = () => {
          dialog.close();
          if (zone !== selected) change(zone);
        };
        options.append(button);
      }
    }
    input.oninput = showZones;
    dialog.addEventListener("close", () => dialog.remove(), { once: true });
    document.body.append(dialog);
    showZones();
    dialog.showModal();
  };
}

async function api(path, options) {
  const response = await fetch("./api/events" + path, options);
  const data = await response.json();
  if (!response.ok) {
    const error = new Error(data.code ? t(data.code) : data.error || t("failed"));
    error.status = response.status;
    throw error;
  }
  return data;
}

function write(method, body) {
  return { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) };
}

function errorText(error) {
  if (error instanceof TypeError || error instanceof SyntaxError) return t("offline");
  return error.message;
}

function setStatus(message) {
  const status = app.querySelector("[data-status]");
  if (status) status.textContent = message;
}

async function copyLink(button) {
  const url = new URL(location.href);
  url.searchParams.delete("share");
  url.searchParams.delete("lang");
  const shareUrl = url.href;
  try {
    await navigator.clipboard.writeText(shareUrl);
    const previous = button.innerHTML;
    button.textContent = t("copied");
    button.setAttribute("aria-label", t("copiedLabel"));
    setTimeout(() => {
      button.innerHTML = previous;
      button.removeAttribute("aria-label");
    }, 1800);
  } catch {
    window.prompt(t("copyPrompt"), shareUrl);
  }
}

function legend() {
  return `<div class="legend" aria-label="${t("legend")}">
    <span><i class="swatch empty"></i>${t("noneSome")}</span>
    <span><i class="swatch partial"></i>${t("some")}</span>
    <span><i class="swatch full"></i>${t("all")}</span></div>`;
}

function bindTwoPointSelection(button, hint, label, steps, apply) {
  let active = false;
  let anchor;
  function update() {
    button.setAttribute("aria-pressed", active);
    hint.textContent = active ? steps[anchor ? 2 : 1] : steps[0];
  }
  function reset() {
    anchor?.removeAttribute("data-anchor");
    anchor = null;
    active = false;
    update();
  }
  button.textContent = label;
  button.onclick = () => {
    if (active) return reset();
    active = true;
    update();
  };
  update();
  return {
    reset,
    tap(cell) {
      if (!active) return apply(cell, cell);
      if (!anchor) {
        anchor = cell;
        cell.setAttribute("data-anchor", "");
        return update();
      }
      apply(anchor, cell);
      reset();
    },
  };
}

function renderCreate() {
  home.hidden = true;
  app.innerHTML = `
    <div class="create-layout">
      <section class="panel create-panel">
        <h1>${t("create")}</h1>
        <form id="create-form">
          <label class="field-label" for="title">${t("title")}</label>
          <input type="text" id="title" name="title" maxlength="80" required placeholder="${t("example")}">
          <button type="button" class="button secondary compact zone-picker" id="zone-picker"></button>
          <div class="create-fields">
          <section>
          <div class="date-label"><span class="field-label" id="candidate-label">${t("dates")}</span><span id="date-count"></span></div>
          <div class="calendar" role="group" aria-labelledby="candidate-label">
            <div class="calendar-top">
              <button type="button" class="button subtle" id="prev-month" aria-label="${t("prev")}">‹</button>
              <strong id="calendar-month" aria-live="polite"></strong>
              <button type="button" class="button subtle" id="next-month" aria-label="${t("next")}">›</button>
            </div>
            <div class="calendar-week" aria-hidden="true">${Array.from({ length: 7 }, (_, i) =>
              "<span>" + weekday(shiftDate("2026-01-05", i)) + "</span>").join("")}</div>
            <div class="calendar-days"></div>
          </div>
          <div class="selection-tools">
            <button class="button secondary compact" id="date-range" type="button"></button>
            <p class="field-help" id="date-hint" aria-live="polite"></p>
          </div>
          <p class="status" id="date-status" role="status"></p>
          <div id="date-chips" class="date-chips"></div>
          <p class="field-help expiry-note" id="expiry-preview" aria-live="polite"></p>
          </section>
          <section>
            <div class="date-label"><span class="field-label" id="hours-label">${t("hours")}</span></div>
            <div class="hour-boundaries" role="group" aria-label="${t("boundary")}">
              <button class="button secondary compact" type="button" data-boundary="start"></button>
              <button class="button secondary compact" type="button" data-boundary="end"></button>
            </div>
            <div class="hour-options" role="group" aria-labelledby="hours-label">
              ${Array.from({ length: 25 }, (_, hour) => '<button type="button" data-hour="' + hour +
                '">' + hourText(hour) + "</button>").join("")}
            </div>
            <p class="field-help" id="hour-hint" aria-live="polite"></p>
          </section>
          </div>
          <p class="status" data-status role="status"></p>
          <button class="button primary create-button" type="submit">${t("createLink")} ${arrow}</button>
        </form>
      </section>
    </div>`;

  let dates = new Set();
  let timeZone = preference("event-zone") || browserZone;
  if (!validTimeZone(timeZone)) timeZone = defaultZone;
  let today = localTime(Date.now(), timeZone).date;
  let month = today.slice(0, 7);
  const calendar = app.querySelector(".calendar-days");
  const chips = app.querySelector("#date-chips");
  const dateStatus = app.querySelector("#date-status");
  const previous = app.querySelector("#prev-month");
  const next = app.querySelector("#next-month");
  let startHour = 9;
  let endHour = 23;
  let boundary = "start";
  const boundaries = app.querySelector(".hour-boundaries");
  const hours = app.querySelector(".hour-options");

  function showHours() {
    for (const button of boundaries.children) {
      const start = button.dataset.boundary === "start";
      button.textContent = t(start ? "start" : "end", { time: hourText(start ? startHour : endHour) });
      button.setAttribute("aria-pressed", button.dataset.boundary === boundary);
    }
    for (const button of hours.children) {
      const hour = Number(button.dataset.hour);
      button.disabled = boundary === "start" ? hour === 24 : hour === 0;
      button.toggleAttribute("data-in-range", hour >= startHour && hour <= endHour);
      button.setAttribute("aria-pressed", hour === (boundary === "start" ? startHour : endHour));
    }
    app.querySelector("#hour-hint").textContent = t(boundary === "start" ? "startHint" : "endHint");
  }
  boundaries.onclick = click => {
    const button = click.target.closest("[data-boundary]");
    if (!button) return;
    boundary = button.dataset.boundary;
    showHours();
  };
  hours.onclick = click => {
    const button = click.target.closest("[data-hour]");
    if (!button || button.disabled) return;
    const hour = Number(button.dataset.hour);
    if (boundary === "start") {
      startHour = hour;
      endHour = Math.max(endHour, startHour + 1);
      boundary = "end";
      boundaries.querySelector('[data-boundary="end"]').focus();
    } else {
      endHour = hour;
      startHour = Math.min(startHour, endHour - 1);
    }
    showHours();
  };
  showHours();

  function showCalendar() {
    app.querySelector("#calendar-month").textContent = monthFormatter.format(new Date(month + "-01"));
    previous.disabled = month <= today.slice(0, 7);
    next.disabled = month === "9999-11";
    calendar.innerHTML = calendarDates(month).map(date => `
      <button type="button" class="calendar-date${date.startsWith(month) ? "" : " other-month"}"
        data-calendar-date="${date}" aria-label="${date} ${weekday(date)}"
        ${date === today ? 'aria-current="date"' : ""} ${date < today ? "disabled" : ""}>
        ${Number(date.slice(-2))}
      </button>`).join("");
    showDates();
  }

  function showDates() {
    const sorted = [...dates].sort();
    const span = sorted.length ? daysBetween(sorted[0], sorted.at(-1)) + 1 : 0;
    app.querySelector("#date-count").textContent = t("dateCount", { count: dates.size, span });
    app.querySelector("#expiry-preview").textContent = sorted.length
      ? t("expiry", { date: dateTime(eventExpiry(sorted.at(-1), timeZone), timeZone) })
      : t("spanHint");
    for (const button of calendar.children) {
      button.setAttribute("aria-pressed", dates.has(button.dataset.calendarDate));
    }
    chips.innerHTML = sorted.map(date => `
      <button class="date-chip" type="button" data-date="${date}" aria-label="${t("remove", { date: dateLabel(date) })}">
        ${dateLabel(date)} <span aria-hidden="true">×</span>
      </button>`).join("");
  }
  previous.onclick = () => {
    dateRange.reset();
    dateStatus.textContent = "";
    month = shiftDate(month + "-01", -1).slice(0, 7);
    showCalendar();
  };
  next.onclick = () => {
    dateRange.reset();
    dateStatus.textContent = "";
    month = shiftDate(month + "-01", 32).slice(0, 7);
    showCalendar();
  };
  function selectDates(first, last, before = dates) {
    const start = first.dataset.calendarDate;
    const end = last.dataset.calendarDate;
    const step = start <= end ? 1 : -1;
    const add = !before.has(start);
    const sorted = [...before].sort();
    let earliest = sorted[0] ?? start;
    let latest = sorted.at(-1) ?? start;
    dates = new Set(before);
    dateStatus.textContent = "";
    for (let date = start; step === 1 ? date <= end : date >= end; date = shiftDate(date, step)) {
      if (add) {
        earliest = date < earliest ? date : earliest;
        latest = date > latest ? date : latest;
        if (daysBetween(earliest, latest) >= maxDateSpan) {
          dateStatus.textContent = t("spanLimit");
          break;
        }
        dates.add(date);
      } else {
        dates.delete(date);
      }
    }
    showDates();
  }
  const dateRange = bindTwoPointSelection(app.querySelector("#date-range"), app.querySelector("#date-hint"),
    t("range"), [t("dateHint"), t("dateFirst"), t("dateLast")], selectDates);
  bindDragSelection(calendar, ".calendar-date", {
    snapshot: () => new Set(dates),
    restore: before => {
      dates = before;
      dateStatus.textContent = "";
      showDates();
    },
    preview: (first, last, before) => {
      dateRange.reset();
      selectDates(first, last, before);
    },
    tap: dateRange.tap,
  });
  chips.onclick = click => {
    const chip = click.target.closest("[data-date]");
    if (!chip) return;
    dates.delete(chip.dataset.date);
    dateStatus.textContent = "";
    showDates();
    calendar.querySelector('[data-calendar-date="' + chip.dataset.date + '"]')?.focus();
  };
  showCalendar();
  function showZonePicker() {
    bindZonePicker(t("eventZone"), timeZone, [], zone => {
      timeZone = zone;
      preference("event-zone", zone);
      today = localTime(Date.now(), zone).date;
      if (month < today.slice(0, 7)) month = today.slice(0, 7);
      dates = new Set([...dates].filter(date => date >= today));
      dateRange.reset();
      dateStatus.textContent = "";
      showCalendar();
      showZonePicker();
    });
  }
  showZonePicker();

  app.querySelector("#create-form").onsubmit = async submit => {
    submit.preventDefault();
    const form = submit.currentTarget;
    const data = new FormData(form);
    if (!dates.size) return setStatus(t("noDates"));
    if (endHour <= startHour) return setStatus(t("badHours"));
    const button = form.querySelector("[type=submit]");
    button.disabled = true;
    setStatus("");
    try {
      const created = await api("", write("POST", {
        title: data.get("title"), dates: [...dates], startHour, endHour, timeZone,
      }));
      const url = new URL(location.href);
      url.searchParams.set("e", created.event.id);
      url.searchParams.set("share", "1");
      location.assign(url);
    } catch (error) {
      setStatus(errorText(error));
      button.disabled = false;
    }
  };
}

function eventHeading(label, description, tools = "") {
  return `
    <div class="event-heading">
      <div><div class="eyebrow">${heatIcon} ${label}</div><h1>${escape(event.title)}</h1>
      ${description ? '<p class="muted">' + description + "</p>" : ""}
      <p class="field-help">${t("expiryAt", { date: dateTime(event.expiresAt, displayZone), zone: displayZone })}</p></div>
      ${tools ? '<div class="heading-actions">' + tools + "</div>" : ""}
    </div>`;
}

function showUnavailable(message) {
  app.innerHTML = `<div class="event-layout"><h1>${t("unavailable")}</h1><p class="muted">
    ${escape(message)}</p><a class="button secondary" href="./">${t("home")}</a></div>`;
}

function handleUnavailable(error) {
  if (error.status !== 404 && error.status !== 410) return false;
  showUnavailable(errorText(error));
  return true;
}

function checkPageExpiry() {
  const remaining = event.expiresAt - Date.now();
  if (remaining <= 0) {
    showUnavailable(t("expired"));
    return;
  }
  setTimeout(checkPageExpiry, Math.min(remaining, 2_147_483_647));
}

function dayCells(date) {
  return [...displayedSlots.get(date).values()].map(slot => slot.key);
}

function slotLabel(slot) {
  return slotFormatter.format(slot.start) + " – " + slotFormatter.format(slot.end);
}

function setDisplayZone(zone) {
  displayZone = zone;
  displayedSlots = displaySlots(event, zone);
  slotFormatter = new Intl.DateTimeFormat(locale, {
    timeZone: displayZone, month: "numeric", day: "numeric", hour: "2-digit",
    minute: "2-digit", hourCycle: "h23", timeZoneName: "shortOffset",
  });
}

function bindDisplayZone(redraw) {
  bindZonePicker(t("viewZone"), displayZone, [event.timeZone], zone => {
    preference("display-zone", zone);
    setDisplayZone(zone);
    redraw();
  });
}

function grid(mode, slots = {}, total = 0) {
  const result = mode === "results";
  const localDates = [...displayedSlots.keys()].sort();
  const first = localDates[0];
  const last = localDates.at(-1);
  const span = daysBetween(first, last) + 1;
  let dates = localDates;
  if (span <= maxDateSpan) dates = pollWeek(first, last);
  else if (daysBetween(event.dates[0], event.dates.at(-1)) < maxDateSpan) {
    dates = Array.from({ length: span }, (_, i) => shiftDate(first, i));
  }
  const times = [...new Set(localDates.flatMap(date => [...displayedSlots.get(date).keys()]))].sort();
  const columns = dates.map(date => {
    const day = new Date(date).getUTCDay();
    const candidate = displayedSlots.has(date);
    const className = !candidate ? "inactive-day" : day === 0 || day === 6 ? "weekend" : "";
    return { date, candidate, className };
  });
  const header = columns.map(({ date, candidate, className }) => {
    const label = `<strong>${dateText(date)}</strong><span>${weekday(date)}</span>`;
    if (!candidate || result) {
      return `<th scope="col" class="${className}"${candidate ? "" : ' aria-label="' + t("inactive", { date: dateLabel(date) }) + '"'}>
        <div class="day-header">${label}</div></th>`;
    }
    return `<th scope="col" class="${className}"><button class="day-header day-toggle" data-day="${date}"
      type="button">${label}<small></small></button></th>`;
  }).join("");
  const rows = times.map((time, row) => {
    const cells = columns.map(({ date, className }, column) => {
      const slot = displayedSlots.get(date)?.get(time);
      if (!slot) return '<td class="inactive-day"></td>';
      const count = slots[slot.key]?.length || 0;
      const label = slotLabel(slot) + (result ? " · " + t("available", { count }) : "");
      return `<td class="${className}"><button type="button" class="slot ${result ? "result-slot" : "vote-slot"}"
        data-cell="${slot.key}" data-start="${slot.start}" data-end="${slot.end}"
        data-row="${row}" data-column="${column}" aria-label="${escape(label)}" title="${escape(label)}"
        ${result ? 'style="--fill:' + heatColor(count, total) + '"' : ""}>
        ${result ? count : '<span aria-hidden="true">✓</span>'}</button></td>`;
    }).join("");
    const [hour, repeat] = time.split("#");
    return '<tr><th scope="row">' + hour + (repeat ? " <sup>" + repeat + "</sup>" : "") + "</th>" + cells + "</tr>";
  }).join("");
  return `<div class="time-grid"><table aria-label="${t(result ? "heat" : "availability")}"
    style="--rows:${times.length}"><thead><tr><th scope="col">${t("time")}</th>${header}</tr></thead>
    <tbody>${rows}</tbody></table></div>`;
}

function markSelection() {
  for (const button of app.querySelectorAll(".vote-slot")) {
    button.setAttribute("aria-pressed", chosen.has(button.dataset.cell));
  }
  for (const button of app.querySelectorAll(".day-toggle")) {
    const cells = dayCells(button.dataset.day);
    const count = cells.filter(cell => chosen.has(cell)).length;
    const state = count === cells.length ? "on" : count ? "mixed" : "off";
    button.dataset.state = state;
    const label = state === "on" ? t("allDay") : count ? count + " h" : t("unselected");
    button.querySelector("small").textContent = label;
    button.setAttribute("aria-pressed", state === "mixed" ? "mixed" : String(state === "on"));
  }
  app.querySelector("#selected-count").textContent = t("selectedHours", { count: chosen.size });
  app.querySelector("#submit-vote").innerHTML =
    t(chosen.size ? "submit" : "noneSubmit") + " " + arrow;
}

function changeCells(cells, selected) {
  for (const cell of cells) {
    if (selected) chosen.add(cell);
    else chosen.delete(cell);
  }
  markSelection();
}

function bindGrid() {
  const table = app.querySelector("table");
  table.addEventListener("click", click => {
    const day = click.target.closest(".day-toggle");
    if (day) {
      range.reset();
      const cells = dayCells(day.dataset.day);
      changeCells(cells, !cells.every(cell => chosen.has(cell)));
      return;
    }
  });
  function selectSlots(first, last, before = chosen) {
    const left = Math.min(+first.dataset.column, +last.dataset.column);
    const right = Math.max(+first.dataset.column, +last.dataset.column);
    const top = Math.min(+first.dataset.row, +last.dataset.row);
    const bottom = Math.max(+first.dataset.row, +last.dataset.row);
    const cells = [...table.querySelectorAll(".vote-slot")].filter(({ dataset }) =>
      dataset.column >= left && dataset.column <= right && dataset.row >= top && dataset.row <= bottom,
    ).map(button => button.dataset.cell);
    chosen = new Set(before);
    changeCells(cells, !before.has(first.dataset.cell));
  }
  const range = bindTwoPointSelection(app.querySelector("#slot-range"), app.querySelector("#slot-hint"),
    t("slotRange"), [t("slotHint"), t("slotFirst"), t("slotLast")], selectSlots);
  bindDragSelection(table, ".vote-slot", {
    snapshot: () => new Set(chosen),
    restore: before => {
      chosen = before;
      markSelection();
    },
    preview: (first, last, before) => {
      range.reset();
      selectSlots(first, last, before);
    },
    tap: range.tap,
  });
  return range;
}

function showFirstVisitGuide() {
  const guide = app.querySelector("#vote-guide");
  const key = "yuetime:guide:" + eventId;
  try {
    if (localStorage.getItem(key) === "seen") return;
  } catch {}
  guide.showModal();
  try {
    localStorage.setItem(key, "seen");
  } catch {}
}

function renderVote(preserveDraft = false) {
  if (preserveDraft !== true) {
    chosen = new Set(vote?.cells || []);
    draftName = vote?.name || "";
  }
  app.innerHTML = `<div class="event-layout">
    ${eventHeading(t(justCreated ? "created" : "voting"), "",
      '<button class="button secondary" id="copy-link">' + linkIcon + " " + t("copy") + "</button>")}
    <form id="vote-form" class="panel vote-panel">
      <button type="button" class="button secondary compact zone-picker" id="zone-picker"></button>
      <div class="vote-top"><div class="name-field">
        <label class="field-label" for="name">${t("name")}</label>
        <input type="text" id="name" required maxlength="40" placeholder="${t("nameExample")}" autocomplete="nickname">
      </div><div class="grid-tools">
        <button class="button secondary compact" id="slot-range" type="button"></button>
        <button class="button secondary compact" id="select-all" type="button">${t("selectAll")}</button>
        <button class="button subtle compact" id="clear-all" type="button">${t("clear")}</button>
      </div></div>
      <p class="field-help grid-help" id="slot-hint" aria-live="polite"></p>
      <div class="vote-actions"><div>
        <strong id="selected-count"></strong>
        <p class="status" data-status role="status"></p>
      </div><div class="grid-tools">
        ${vote ? '<button type="button" class="button subtle" id="back-results">' + t("cancel") + "</button>" : ""}
        <button class="button primary" type="submit" id="submit-vote"></button>
      </div></div>
      ${grid("vote")}
    </form>
    <dialog id="vote-guide" class="vote-guide" aria-labelledby="vote-guide-title">
      <form method="dialog">
        <button class="guide-close" type="submit" aria-label="${t("closeGuide")}" autofocus>×</button>
      </form>
      <h2 id="vote-guide-title">${t("guide")}</h2>
      <ol>
        <li>${t("guide1")}</li>
        <li>${t("guide2")}</li>
        <li>${t("guide3")}</li>
      </ol>
      <p>${t("guide4")} ${t("zoneNote")}</p>
      <p>${t("guide5")}</p>
    </dialog>
  </div>`;
  app.querySelector("#name").value = draftName;
  bindDisplayZone(() => {
    draftName = app.querySelector("#name").value;
    renderVote(true);
  });
  app.querySelector("#copy-link").onclick = click => copyLink(click.currentTarget);
  const range = bindGrid();
  app.querySelector("#select-all").onclick = () => {
    range.reset();
    changeCells([...displayedSlots.keys()].flatMap(dayCells), true);
  };
  app.querySelector("#clear-all").onclick = () => {
    range.reset();
    changeCells([...chosen], false);
  };
  if (vote) app.querySelector("#back-results").onclick = loadResults;
  markSelection();
  app.querySelector("#vote-form").onsubmit = async submit => {
    submit.preventDefault();
    draftName = app.querySelector("#name").value.trim();
    if (!draftName) return setStatus(t("enterName"));
    if (!chosen.size && !window.confirm(t("confirmEmpty"))) return;
    const button = app.querySelector("#submit-vote");
    const controls = [...submit.currentTarget.querySelectorAll("button, input")];
    controls.forEach(control => { control.disabled = true; });
    button.textContent = t("submitting");
    setStatus("");
    try {
      const saved = await api("/" + eventId + "/vote", write("PUT", { name: draftName, cells: [...chosen] }));
      vote = saved.vote;
      justCreated = false;
      await loadResults();
    } catch (error) {
      if (handleUnavailable(error)) return;
      controls.forEach(control => { control.disabled = false; });
      markSelection();
      setStatus(errorText(error));
    }
  };
}

function heatColor(count, total) {
  if (!count) return "var(--slot-bg)";
  if (count === total) return "#22c55e";
  const ratio = count / total;
  const orange = [245, 158, 11];
  const yellowGreen = [163, 198, 53];
  const channels = orange.map((value, index) => Math.round(value + (yellowGreen[index] - value) * ratio));
  return "rgba(" + channels.join(",") + "," + (0.35 + 0.5 * ratio).toFixed(2) + ")";
}

function renderResults({ total, slots }) {
  app.innerHTML = `<div class="event-layout">
    ${eventHeading(t("heat"), "",
      '<button class="button secondary" id="copy-link">' + linkIcon + " " + t("copy") + "</button>")}
    <section class="panel results-panel">
      <div class="results-top"><div class="response-count"><span></span>${t("replies", { count: total })}</div>
        <div class="grid-tools">
          <button type="button" class="button secondary compact zone-picker" id="zone-picker"></button>
          <button class="button subtle" id="refresh">${refreshIcon} ${t("refresh")}</button>
          <button class="button secondary" id="edit-vote">${t("edit")}</button>
        </div>
      </div>
      ${legend()}
      <p class="status" data-status role="status"></p>
      <section id="slot-detail" class="slot-detail" aria-live="polite" hidden></section>
      ${grid("results", slots, total)}
    </section>
  </div>`;
  app.querySelector("#copy-link").onclick = click => copyLink(click.currentTarget);
  bindDisplayZone(() => renderResults({ total, slots }));
  app.querySelector("#edit-vote").onclick = renderVote;
  app.querySelector("#refresh").onclick = loadResults;
  const detail = app.querySelector("#slot-detail");
  app.querySelector("table").onclick = click => {
    const slot = click.target.closest(".result-slot");
    if (!slot) return;
    app.querySelector(".result-slot[aria-current]")?.removeAttribute("aria-current");
    slot.setAttribute("aria-current", "true");
    const names = slots[slot.dataset.cell] || [];
    detail.hidden = false;
    const label = slotLabel({ start: +slot.dataset.start, end: +slot.dataset.end });
    const summary = names.length ? t("available", { count: names.length + "/" + total }) +
      " · " + new Intl.ListFormat(locale).format(names) : t("noneSlot");
    detail.innerHTML = "<strong>" + escape(label) + "</strong><p>" + escape(summary) + "</p>";
  };
}

async function loadResults() {
  const button = app.querySelector("#refresh");
  if (button) button.disabled = true;
  try {
    const data = await api("/" + eventId + "/results");
    if (Date.now() >= event.expiresAt) {
      showUnavailable(t("expired"));
      return;
    }
    renderResults(data);
  } catch (error) {
    if (handleUnavailable(error)) return;
    if (button) {
      setStatus(errorText(error));
      button.disabled = false;
    } else {
      app.innerHTML = '<div class="event-layout">' + eventHeading(t("saved"), escape(errorText(error))) +
        '<button class="button primary" id="retry-results">' + t("reload") + "</button></div>";
      app.querySelector("#retry-results").onclick = loadResults;
    }
  }
}

async function init() {
  if (!eventId) return renderCreate();
  home.hidden = false;
  try {
    ({ event, vote } = await api("/" + encodeURIComponent(eventId)));
    const zone = preference("display-zone") || browserZone;
    setDisplayZone(validTimeZone(zone) ? zone : event.timeZone || defaultZone);
    document.title = event.title + " · " + t("brand");
    const url = new URL(location.href);
    justCreated = url.searchParams.has("share") && !vote;
    if (url.searchParams.has("share")) {
      url.searchParams.delete("share");
      history.replaceState(null, "", url);
    }
    if (vote) await loadResults();
    else {
      renderVote();
      showFirstVisitGuide();
    }
    checkPageExpiry();
  } catch (error) {
    showUnavailable(errorText(error));
  }
}

init();
