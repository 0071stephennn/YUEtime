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
let drag;
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
  if (!response.ok) throw new Error(data.error || "操作未完成，请重试。");
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

function dateOffset(days) {
  const date = new Date();
  date.setDate(date.getDate() + days);
  return [
    date.getFullYear(), String(date.getMonth() + 1).padStart(2, "0"),
    String(date.getDate()).padStart(2, "0"),
  ].join("-");
}

function selectOptions(first, last, selected) {
  return Array.from({ length: last - first + 1 }, (_, index) => {
    const hour = first + index;
    return '<option value="' + hour + '"' + (hour === selected ? " selected" : "") +
      ">" + hourText(hour) + "</option>";
  }).join("");
}

function sampleGrid() {
  const values = [[0, 1, 2, 0, 1], [1, 2, 3, 0, 2], [0, 2, 4, 3, 2], [1, 3, 4, 4, 1], [0, 1, 3, 2, 0]];
  return '<div class="sample-grid"><span></span>' +
    ["周三", "周四", "周五", "周六", "周日"].map(day => "<b>" + day + "</b>").join("") +
    values.map((row, index) => "<b>" + hourText(index + 15) + "</b>" + row.map(count =>
      '<span class="sample-cell" style="--fill:' + heatColor(count, 4) + '">' + count + "</span>",
    ).join("")).join("") + "</div>";
}

function legend() {
  return '<div class="legend" aria-label="热力图图例">' +
    '<span><i class="swatch empty"></i>无人有空</span>' +
    '<span><i class="swatch partial"></i>部分有空</span>' +
    '<span><i class="swatch full"></i>全员有空</span></div>';
}

function renderCreate() {
  home.hidden = true;
  app.innerHTML = `
    <div class="create-layout">
      <section class="intro">
        <div class="eyebrow">${heatIcon} 群体时间协调</div>
        <h1>大家什么时候<br>有空<span>？</span></h1>
        <p class="intro-description">圈出几个候选日期，把链接发给大家。<br>每个人填好自己的时间，就能看到空闲热力图。</p>
        <figure class="sample">
          <figcaption><strong>热力图示例</strong><span>4 人已回复</span></figcaption>
          ${sampleGrid()}
          ${legend()}
        </figure>
      </section>
      <section class="panel create-panel">
        <h2>创建活动</h2>
        <p class="muted">设置候选时间，生成一条可分享的链接。</p>
        <form id="create-form">
          <label class="field-label" for="title">活动名称</label>
          <input type="text" id="title" name="title" maxlength="80" required placeholder="例如：周末聚餐">
          <div class="date-label"><label class="field-label" for="date-picker">候选日期</label><span id="date-count"></span></div>
          <div class="date-input"><input id="date-picker" type="date" aria-label="添加候选日期"><button class="button secondary" type="button" id="add-date">添加</button></div>
          <div id="date-chips" class="date-chips"></div>
          <label class="field-label" for="start">每天的时间范围</label>
          <div class="hour-inputs">
            <select id="start" name="start" aria-label="开始时间">${selectOptions(0, 23, 9)}</select>
            <span aria-hidden="true">至</span>
            <select id="end" name="end" aria-label="结束时间">${selectOptions(1, 24, 23)}</select>
          </div>
          <p class="field-help">按整小时填写，最多选 7 个日期。</p>
          <p class="status" data-status role="status"></p>
          <button class="button primary create-button" type="submit">创建活动并获取链接 ${arrow}</button>
        </form>
      </section>
    </div>`;

  const dates = new Set([dateOffset(0), dateOffset(1), dateOffset(2)]);
  const picker = app.querySelector("#date-picker");
  const add = app.querySelector("#add-date");
  const chips = app.querySelector("#date-chips");
  picker.value = dateOffset(3);
  function showDates() {
    app.querySelector("#date-count").textContent = dates.size + " / 7 天";
    add.disabled = dates.size >= 7;
    chips.innerHTML = [...dates].sort().map(date => `
      <button class="date-chip" type="button" data-date="${date}" aria-label="移除 ${dateLabel(date)}">
        ${dateLabel(date)} <span aria-hidden="true">×</span>
      </button>`).join("");
  }
  function addDate() {
    if (!picker.value) return setStatus("请先选一个日期。");
    if (dates.has(picker.value)) return setStatus("这个日期已经添加。");
    if (dates.size >= 7) return;
    dates.add(picker.value);
    picker.value = "";
    setStatus("");
    showDates();
  }
  add.onclick = addDate;
  picker.onkeydown = event => {
    if (event.key === "Enter") {
      event.preventDefault();
      addDate();
    }
  };
  chips.onclick = click => {
    const chip = click.target.closest("[data-date]");
    if (!chip) return;
    dates.delete(chip.dataset.date);
    setStatus("");
    showDates();
    add.focus();
  };
  showDates();

  app.querySelector("#create-form").onsubmit = async submit => {
    submit.preventDefault();
    const form = submit.currentTarget;
    const data = new FormData(form);
    const startHour = Number(data.get("start"));
    const endHour = Number(data.get("end"));
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
      <p class="muted">${description}</p></div>
      ${tools ? '<div class="heading-actions">' + tools + "</div>" : ""}
    </div>`;
}

function dayCells(date) {
  return makeHours(event).map(hour => date + "|" + hour);
}

function grid(mode, slots = {}, total = 0) {
  const result = mode === "results";
  const header = event.dates.map(date => `
    <th scope="col">${result
      ? '<div class="day-header"><strong>' + dateText(date) + '</strong><span>' + weekday(date) + '</span></div>'
      : '<button class="day-header day-toggle" data-day="' + date + '" type="button"><strong>' +
        dateText(date) + '</strong><span>' + weekday(date) + '</span><small></small></button>'}</th>`).join("");
  const rows = makeHours(event).map(hour => {
    const cells = event.dates.map(date => {
      const cell = date + "|" + hour;
      const count = slots[cell]?.length || 0;
      const label = dateLabel(date) + " " + hourText(hour) + "–" + hourText(hour + 1);
      return `<td><button type="button" class="slot ${result ? "result-slot" : "vote-slot"}"
        data-cell="${cell}" aria-label="${label}${result ? "，" + count + " 人有空" : ""}"
        ${result ? 'style="--fill:' + heatColor(count, total) + '"' : ""}>
        ${result ? count : '<span aria-hidden="true">✓</span>'}</button></td>`;
    }).join("");
    return '<tr><th scope="row">' + hourText(hour) + "</th>" + cells + "</tr>";
  }).join("");
  return `<div class="grid-scroll"><table aria-label="${result ? "空闲热力图" : "选择空闲时间"}"
    style="--days:${event.dates.length}"><thead><tr><th scope="col">时间</th>${header}</tr></thead>
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
    const label = state === "on" ? "全天有空" : count ? "已选 " + count + " 小时" : "未选";
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
      const cells = dayCells(day.dataset.day);
      changeCells(cells, !cells.every(cell => chosen.has(cell)));
      return;
    }
    const slot = click.target.closest(".vote-slot");
    if (slot && drag?.handledClick && click.detail !== 0) {
      drag = undefined;
      return;
    }
    if (slot) changeCells([slot.dataset.cell], !chosen.has(slot.dataset.cell));
  });

  table.addEventListener("pointerdown", pointer => {
    const slot = pointer.target.closest(".vote-slot");
    if (!slot || pointer.button !== 0 || pointer.pointerType === "touch") return;
    const [date, hour] = slot.dataset.cell.split("|");
    drag = {
      date, hour: Number(hour), id: pointer.pointerId, selected: !chosen.has(slot.dataset.cell),
      snapshot: new Set(chosen), moved: false,
    };
  });
  table.addEventListener("pointermove", pointer => {
    if (drag?.id !== pointer.pointerId || pointer.buttons !== 1) return;
    const slot = document.elementFromPoint(pointer.clientX, pointer.clientY)?.closest(".vote-slot");
    if (!slot) return;
    const [date, hour] = slot.dataset.cell.split("|");
    if (date !== drag.date || (+hour === drag.hour && !drag.moved)) return;
    drag.moved = true;
    chosen = new Set(drag.snapshot);
    const first = Math.min(+hour, drag.hour);
    const last = Math.max(+hour, drag.hour);
    changeCells(Array.from({ length: last - first + 1 }, (_, index) =>
      date + "|" + (first + index)), drag.selected);
  });
  table.addEventListener("pointerup", pointer => {
    if (drag?.id !== pointer.pointerId) return;
    if (drag.moved) {
      drag.handledClick = true;
      setTimeout(() => { if (drag?.handledClick) drag = undefined; }, 0);
    } else drag = undefined;
  });
  table.addEventListener("pointercancel", () => { drag = undefined; });
}

function renderVote() {
  drag = undefined;
  chosen = new Set(vote?.cells || []);
  draftName = vote?.name || "";
  app.innerHTML = `<div class="event-layout">
    ${eventHeading(justCreated ? "活动已创建" : "填写时间",
      justCreated ? "把链接发到群里，再填好你自己的时间。提交后即可查看热力图。"
        : "选中你有空的时段，提交后查看大家的时间。",
      '<button class="button secondary" id="copy-link">' + linkIcon + " 复制群链接</button>")}
    <form id="vote-form" class="panel vote-panel">
      <div class="vote-top"><div class="name-field">
        <label class="field-label" for="name">你的名字</label>
        <input type="text" id="name" required maxlength="40" placeholder="例如：小王" autocomplete="nickname">
      </div><div class="grid-tools">
        <button class="button secondary" id="select-all" type="button">全部有空</button>
        <button class="button subtle" id="clear-all" type="button">清空</button>
      </div></div>
      <p class="field-help grid-help">点日期选整天，点单格调整。电脑上也可以沿一天拖动。</p>
      ${grid("vote")}
      <div class="vote-bottom"><div>
        <strong id="selected-count"></strong>
        <p class="status" data-status role="status"></p>
      </div><div class="grid-tools">
        ${vote ? '<button type="button" class="button subtle" id="back-results">取消修改</button>' : ""}
        <button class="button primary" type="submit" id="submit-vote"></button>
      </div></div>
    </form>
  </div>`;
  app.querySelector("#name").value = draftName;
  app.querySelector("#copy-link").onclick = click => copyLink(click.currentTarget);
  app.querySelector("#select-all").onclick = () => changeCells(event.dates.flatMap(dayCells), true);
  app.querySelector("#clear-all").onclick = () => changeCells([...chosen], false);
  if (vote) app.querySelector("#back-results").onclick = loadResults;
  bindGrid();
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
    ${eventHeading("空闲热力图", "每格显示这一小时有空的人数。点击格子查看名单。",
      '<button class="button secondary" id="copy-link">' + linkIcon + " 复制链接</button>")}
    <section class="panel results-panel">
      <div class="results-top"><div class="response-count"><span></span>已回复 <strong>${total}</strong> 人</div>
        <div class="grid-tools">
          <button class="button subtle" id="refresh">${refreshIcon} 刷新</button>
          <button class="button secondary" id="edit-vote">修改我的时间</button>
        </div>
      </div>
      ${grid("results", slots, total)}
      ${legend()}
      <p class="status" data-status role="status"></p>
      <section id="slot-detail" class="slot-detail" aria-live="polite" hidden></section>
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
    detail.scrollIntoView({ block: "nearest" });
  };
}

async function loadResults() {
  const button = app.querySelector("#refresh");
  if (button) button.disabled = true;
  try {
    const data = await api("/" + eventId + "/results");
    renderResults(data);
  } catch (error) {
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
    else renderVote();
  } catch (error) {
    app.innerHTML = '<div class="event-layout"><h1>无法打开活动</h1><p class="muted">' +
      escape(errorText(error)) + '</p><a class="button secondary" href="./">返回首页</a></div>';
  }
}

init();
