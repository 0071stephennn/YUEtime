import { calendarDates, daysBetween, expiryForDate, expiryLabel, maxDateSpan, shiftDate, todayInShanghai } from "./dates.js";
import { bindDragSelection } from "./drag-select.js";

const app = document.querySelector("#app");
const home = document.querySelector("#home-link");
const eventId = new URL(location.href).searchParams.get("e");
const dateFormatter = new Intl.DateTimeFormat("zh-CN", {
  month: "numeric", day: "numeric", timeZone: "UTC",
});
const weekdayFormatter = new Intl.DateTimeFormat("zh-CN", { weekday: "short", timeZone: "UTC" });
let event;
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
const makeHours = ({ startHour, endHour }) =>
  Array.from({ length: endHour - startHour }, (_, index) => startHour + index);

const arrow = '<span aria-hidden="true">→</span>';
const heatIcon = '<span class="mini-grid" aria-hidden="true"><i></i><i></i><i></i><i></i></span>';
const linkIcon = '<svg aria-hidden="true" width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><path d="M10 13a4 4 0 0 0 6 .5l4-4a4 4 0 0 0-6-5.5L12 6m0 6a4 4 0 0 0-6-.5l-4 4a4 4 0 0 0 6 5.5l2-2" stroke-linecap="round" stroke-linejoin="round"/></svg>';
const refreshIcon = '<span class="refresh-icon" aria-hidden="true">↻</span>';

async function api(path, options) {
  const response = await fetch("./api/events" + path, options);
  const data = await response.json();
  if (!response.ok) {
    const error = new Error(data.error || "操作未完成，请重试。");
    error.status = response.status;
    throw error;
  }
  return data;
}

function write(method, body) {
  return { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) };
}

function errorText(error) {
  if (error instanceof TypeError || error instanceof SyntaxError) return "暂时无法连接，请重试。";
  return error.message;
}

function setStatus(message) {
  const status = app.querySelector("[data-status]");
  if (status) status.textContent = message;
}

async function copyLink(button) {
  const url = new URL(location.href);
  url.searchParams.delete("share");
  const shareUrl = url.href;
  try {
    await navigator.clipboard.writeText(shareUrl);
    const previous = button.innerHTML;
    button.innerHTML = "已复制";
    button.setAttribute("aria-label", "链接已复制");
    setTimeout(() => {
      button.innerHTML = previous;
      button.removeAttribute("aria-label");
    }, 1800);
  } catch {
    window.prompt("复制活动链接", shareUrl);
  }
}

function legend() {
  return '<div class="legend" aria-label="热力图图例">' +
    '<span><i class="swatch empty"></i>无人有空</span>' +
    '<span><i class="swatch partial"></i>部分有空</span>' +
    '<span><i class="swatch full"></i>全员有空</span></div>';
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
        <h1>创建活动</h1>
        <form id="create-form">
          <label class="field-label" for="title">活动名称</label>
          <input type="text" id="title" name="title" maxlength="80" required placeholder="例如：周末聚餐">
          <div class="create-fields">
          <section>
          <div class="date-label"><span class="field-label" id="candidate-label">候选日期</span><span id="date-count"></span></div>
          <div class="calendar" role="group" aria-labelledby="candidate-label">
            <div class="calendar-top">
              <button type="button" class="button subtle" id="prev-month" aria-label="上个月">‹</button>
              <strong id="calendar-month" aria-live="polite"></strong>
              <button type="button" class="button subtle" id="next-month" aria-label="下个月">›</button>
            </div>
            <div class="calendar-week" aria-hidden="true">${["一", "二", "三", "四", "五", "六", "日"].map(day => "<span>" + day + "</span>").join("")}</div>
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
            <div class="date-label"><span class="field-label" id="hours-label">每天的时间范围</span></div>
            <div class="hour-boundaries" role="group" aria-label="选择要调整的时间">
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
          <button class="button primary create-button" type="submit">创建活动并获取链接 ${arrow}</button>
        </form>
      </section>
    </div>`;

  let dates = new Set();
  const today = todayInShanghai();
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
      button.textContent = (start ? "开始 " : "结束 ") + hourText(start ? startHour : endHour);
      button.setAttribute("aria-pressed", button.dataset.boundary === boundary);
    }
    for (const button of hours.children) {
      const hour = Number(button.dataset.hour);
      button.disabled = boundary === "start" ? hour === 24 : hour === 0;
      button.toggleAttribute("data-in-range", hour >= startHour && hour <= endHour);
      button.setAttribute("aria-pressed", hour === (boundary === "start" ? startHour : endHour));
    }
    app.querySelector("#hour-hint").textContent = "点选" + (boundary === "start" ? "开始" : "结束") +
      "时间。北京时间，每格一小时。";
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
    const [year, monthNumber] = month.split("-").map(Number);
    app.querySelector("#calendar-month").textContent = year + " 年 " + monthNumber + " 月";
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
    app.querySelector("#date-count").textContent = "已选 " + dates.size + " 天 · 首尾 " + span + " / 7 天";
    app.querySelector("#expiry-preview").textContent = sorted.length
      ? "北京时间 " + expiryLabel(expiryForDate(sorted.at(-1))) + " 失效，随后删除活动和答卷。"
      : "首尾合计最多 7 天，中间可以跳过日期。";
    for (const button of calendar.children) {
      button.setAttribute("aria-pressed", dates.has(button.dataset.calendarDate));
    }
    chips.innerHTML = sorted.map(date => `
      <button class="date-chip" type="button" data-date="${date}" aria-label="移除 ${dateLabel(date)}">
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
          dateStatus.textContent = "候选日期首尾合计不能超过 7 天。";
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
    "连选日期", ["点一天切换，也可以拖选。", "请选择范围的第一个日期。", "请选择范围的最后一个日期。"], selectDates);
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

  app.querySelector("#create-form").onsubmit = async submit => {
    submit.preventDefault();
    const form = submit.currentTarget;
    const data = new FormData(form);
    if (!dates.size) return setStatus("请至少添加一个候选日期。");
    if (endHour <= startHour) return setStatus("结束时间必须晚于开始时间。");
    const button = form.querySelector("[type=submit]");
    button.disabled = true;
    setStatus("");
    try {
      const created = await api("", write("POST", {
        title: data.get("title"), dates: [...dates], startHour, endHour,
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
      <p class="field-help">${expiryLabel(event.expiresAt)} 到期（北京时间）</p></div>
      ${tools ? '<div class="heading-actions">' + tools + "</div>" : ""}
    </div>`;
}

function showUnavailable(message) {
  app.innerHTML = '<div class="event-layout"><h1>活动不可用</h1><p class="muted">' +
    escape(message) + '</p><a class="button secondary" href="./">返回首页</a></div>';
}

function handleUnavailable(error) {
  if (error.status !== 404 && error.status !== 410) return false;
  showUnavailable(errorText(error));
  return true;
}

function checkPageExpiry() {
  const remaining = event.expiresAt - Date.now();
  if (remaining <= 0) {
    showUnavailable("这场活动已过期。");
    return;
  }
  setTimeout(checkPageExpiry, Math.min(remaining, 2_147_483_647));
}

function dayCells(date) {
  return makeHours(event).map(hour => date + "|" + hour);
}

function grid(mode, slots = {}, total = 0) {
  const result = mode === "results";
  const columns = event.dates.flatMap((date, index) => {
    const weekdayIndex = new Date(date).getUTCDay();
    const weekend = weekdayIndex === 0 || weekdayIndex === 6;
    const missing = index ? daysBetween(event.dates[index - 1], date) - 1 : 0;
    return missing > 0 ? [{ missing }, { date, weekend }] : [{ date, weekend }];
  });
  const header = columns.map(({ date, weekend, missing }) => {
    if (missing) {
      const label = "跳过 " + missing + " 天";
      return '<th class="date-gap" scope="col" title="' + label + '" aria-label="' + label + '"></th>';
    }
    return `<th scope="col"${weekend ? ' class="weekend"' : ""}>${result
      ? '<div class="day-header"><strong>' + dateText(date) + '</strong><span>' + weekday(date) + '</span></div>'
      : '<button class="day-header day-toggle" data-day="' + date + '" type="button"><strong>' +
        dateText(date) + '</strong><span>' + weekday(date) + '</span><small></small></button>'}</th>`;
  }).join("");
  const rows = makeHours(event).map(hour => {
    const cells = columns.map(({ date, weekend, missing }) => {
      if (missing) return '<td class="date-gap" aria-hidden="true"></td>';
      const cell = date + "|" + hour;
      const count = slots[cell]?.length || 0;
      const label = dateLabel(date) + " " + hourText(hour) + "–" + hourText(hour + 1);
      return `<td${weekend ? ' class="weekend"' : ""}><button type="button" class="slot ${result ? "result-slot" : "vote-slot"}"
        data-cell="${cell}" aria-label="${label}${result ? "，" + count + " 人有空" : ""}"
        ${result ? 'style="--fill:' + heatColor(count, total) + '"' : ""}>
        ${result ? count : '<span aria-hidden="true">✓</span>'}</button></td>`;
    }).join("");
    return '<tr><th scope="row">' + hourText(hour) + "</th>" + cells + "</tr>";
  }).join("");
  return `<div class="time-grid"><table aria-label="${result ? "空闲热力图" : "选择空闲时间"}"
    style="--rows:${event.endHour - event.startHour}"><thead><tr><th scope="col">时间</th>${header}</tr></thead>
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
    const label = state === "on" ? "全天" : count ? count + " 小时" : "未选";
    button.querySelector("small").textContent = label;
    button.setAttribute("aria-pressed", state === "mixed" ? "mixed" : String(state === "on"));
  }
  app.querySelector("#selected-count").textContent = "已选 " + chosen.size + " 小时";
  app.querySelector("#submit-vote").innerHTML =
    (chosen.size ? "提交并查看热力图 " : "这些时间我都来不了 ") + arrow;
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
      const [startDate, startHour] = first.dataset.cell.split("|");
      const [endDate, endHour] = last.dataset.cell.split("|");
      const left = event.dates.indexOf(startDate);
      const right = event.dates.indexOf(endDate);
      const dates = event.dates.slice(Math.min(left, right), Math.max(left, right) + 1);
      const start = Math.min(+startHour, +endHour);
      const length = Math.abs(+startHour - +endHour) + 1;
      const cells = dates.flatMap(date =>
        Array.from({ length }, (_, index) => date + "|" + (start + index)));
      chosen = new Set(before);
      changeCells(cells, !before.has(first.dataset.cell));
  }
  const range = bindTwoPointSelection(app.querySelector("#slot-range"), app.querySelector("#slot-hint"),
    "框选时段", ["点格切换，点日期选整天。也可以拖选。",
      "请选择框内的第一个格子。", "请选择框的对角格。"], selectSlots);
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

function renderVote() {
  chosen = new Set(vote?.cells || []);
  draftName = vote?.name || "";
  app.innerHTML = `<div class="event-layout">
    ${eventHeading(justCreated ? "活动已创建" : "填写时间", "",
      '<button class="button secondary" id="copy-link">' + linkIcon + " 复制群链接</button>")}
    <form id="vote-form" class="panel vote-panel">
      <div class="vote-top"><div class="name-field">
        <label class="field-label" for="name">你的名字</label>
        <input type="text" id="name" required maxlength="40" placeholder="例如：小王" autocomplete="nickname">
      </div><div class="grid-tools">
        <button class="button secondary compact" id="slot-range" type="button"></button>
        <button class="button secondary compact" id="select-all" type="button">全选</button>
        <button class="button subtle compact" id="clear-all" type="button">清空</button>
      </div></div>
      <p class="field-help grid-help" id="slot-hint" aria-live="polite"></p>
      <div class="vote-actions"><div>
        <strong id="selected-count"></strong>
        <p class="status" data-status role="status"></p>
      </div><div class="grid-tools">
        ${vote ? '<button type="button" class="button subtle" id="back-results">取消修改</button>' : ""}
        <button class="button primary" type="submit" id="submit-vote"></button>
      </div></div>
      ${grid("vote")}
    </form>
    <dialog id="vote-guide" class="vote-guide" aria-labelledby="vote-guide-title">
      <form method="dialog">
        <button class="guide-close" type="submit" aria-label="关闭填写指南" autofocus>×</button>
      </form>
      <h2 id="vote-guide-title">怎么填写</h2>
      <ol>
        <li>填上你的名字，选中你有空的时段。点单格切换，点日期表头选整天。</li>
        <li>选一片时间时，可以拖动，也可以点「框选时段」，再点两个对角格。</li>
        <li>点「提交并查看热力图」。如果都来不了，点「这些时间我都来不了」。</li>
      </ol>
      <p>窄灰条表示中间跳过了日期。浅色列是周六或周日。</p>
      <p>提交后可在热力图上点「修改我的时间」，更新原答卷。</p>
    </dialog>
  </div>`;
  app.querySelector("#name").value = draftName;
  app.querySelector("#copy-link").onclick = click => copyLink(click.currentTarget);
  const range = bindGrid();
  app.querySelector("#select-all").onclick = () => {
    range.reset();
    changeCells(event.dates.flatMap(dayCells), true);
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
    if (!draftName) return setStatus("请填写你的名字。");
    if (!chosen.size && !window.confirm("确认候选时间都来不了？提交后可查看热力图。")) return;
    const button = app.querySelector("#submit-vote");
    const controls = [...submit.currentTarget.querySelectorAll("button, input")];
    controls.forEach(control => { control.disabled = true; });
    button.textContent = "正在提交…";
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
    ${eventHeading("空闲热力图", "",
      '<button class="button secondary" id="copy-link">' + linkIcon + " 复制链接</button>")}
    <section class="panel results-panel">
      <div class="results-top"><div class="response-count"><span></span>已回复 <strong>${total}</strong> 人</div>
        <div class="grid-tools">
          <button class="button subtle" id="refresh">${refreshIcon} 刷新</button>
          <button class="button secondary" id="edit-vote">修改我的时间</button>
        </div>
      </div>
      ${legend()}
      <p class="status" data-status role="status"></p>
      <section id="slot-detail" class="slot-detail" aria-live="polite" hidden></section>
      ${grid("results", slots, total)}
    </section>
  </div>`;
  app.querySelector("#copy-link").onclick = click => copyLink(click.currentTarget);
  app.querySelector("#edit-vote").onclick = renderVote;
  app.querySelector("#refresh").onclick = loadResults;
  const detail = app.querySelector("#slot-detail");
  app.querySelector("table").onclick = click => {
    const slot = click.target.closest(".result-slot");
    if (!slot) return;
    app.querySelector(".result-slot[aria-current]")?.removeAttribute("aria-current");
    slot.setAttribute("aria-current", "true");
    const [date, hour] = slot.dataset.cell.split("|");
    const names = slots[slot.dataset.cell] || [];
    detail.hidden = false;
    detail.innerHTML = '<strong>' + dateLabel(date) + " · " + hourText(+hour) + "–" + hourText(+hour + 1) +
      '</strong><p>' + (names.length ? names.length + "/" + total + " 人有空 · " +
        names.map(escape).join("、") : "这一小时无人有空。") + "</p>";
  };
}

async function loadResults() {
  const button = app.querySelector("#refresh");
  if (button) button.disabled = true;
  try {
    const data = await api("/" + eventId + "/results");
    if (Date.now() >= event.expiresAt) {
      showUnavailable("这场活动已过期。");
      return;
    }
    renderResults(data);
  } catch (error) {
    if (handleUnavailable(error)) return;
    if (button) {
      setStatus(errorText(error));
      button.disabled = false;
    } else {
      app.innerHTML = '<div class="event-layout">' + eventHeading("答卷已保存", escape(errorText(error))) +
        '<button class="button primary" id="retry-results">重新加载热力图</button></div>';
      app.querySelector("#retry-results").onclick = loadResults;
    }
  }
}

async function init() {
  if (!eventId) return renderCreate();
  home.hidden = false;
  try {
    ({ event, vote } = await api("/" + encodeURIComponent(eventId)));
    document.title = event.title + " · 约时间";
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
