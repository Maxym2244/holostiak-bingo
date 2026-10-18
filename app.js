import { createSync, hasFirebase } from "./sync.js";
import {
  VIBES, HER_STATS, HIS_VIBES, TALLIES, NOMINATIONS, BINGO, BINGO_FREE, PAGES,
} from "./data.js";

/* ───────── helpers ───────── */
const $ = (sel, root = document) => root.querySelector(sel);

function h(tag, props = {}, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (v == null || v === false) continue;
    if (k === "class") el.className = v;
    else if (k === "html") el.innerHTML = v;
    else if (k.startsWith("on")) el.addEventListener(k.slice(2), v);
    else el.setAttribute(k, v === true ? "" : v);
  }
  for (const kid of kids.flat()) {
    if (kid != null && kid !== false) el.append(kid.nodeType ? kid : document.createTextNode(kid));
  }
  return el;
}

const slug = (s) => s.trim().toLowerCase().replace(/[.$#[\]/\s]+/g, "_").slice(0, 40);
const LS = {
  get(k) { try { return JSON.parse(localStorage.getItem(k)); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* приватний режим */ } },
};

/* ───────── стан ───────── */
const store = {
  room: "", me: "", viewing: "",
  players: {},          // id -> { name, d }
  get readonly() { return this.viewing !== this.me; },
};
let sync = null;
let page = Number((location.hash.match(/p(\d)/) || [])[1]) || 1;
let firstSnapshot = true;

const bindings = new Map(); // key -> Set<fn(value)>, "*" = будь-яка зміна
const val = (k) => store.players[store.viewing]?.d?.[k];
const playerName = (id) => store.players[id]?.name || id;

function bind(key, fn) {
  if (!bindings.has(key)) bindings.set(key, new Set());
  bindings.get(key).add(fn);
  fn(key === "*" ? undefined : val(key));
}
const refresh = (key) => {
  bindings.get(key)?.forEach((fn) => fn(val(key)));
  bindings.get("*")?.forEach((fn) => fn());
};
const refreshAll = () => {
  for (const [key, set] of bindings) set.forEach((fn) => fn(key === "*" ? undefined : val(key)));
};

let saveTimer = null;
function persistLocal() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => LS.set(`bingo.d.${store.room}.${store.me}`, store.players[store.me].d), 200);
}

function setVal(key, value) {
  if (store.readonly) return;
  const me = store.players[store.me];
  const empty = value === "" || value === 0 || value === false || value == null;
  if (empty) delete me.d[key]; else me.d[key] = value;
  refresh(key);
  persistLocal();
  sync?.write(key, empty ? null : value);
}

/* ───────── будівельні блоки ───────── */
function textField(key, { ph = "", multiline = false, rows = 3, def = () => "", cls = "" } = {}) {
  const el = h(multiline ? "textarea" : "input", {
    class: `field ${multiline ? "ruled" : "line"} ${cls}`,
    placeholder: ph,
    maxlength: 600,
    autocomplete: "off",
    spellcheck: "false",
    rows: multiline ? rows : null,
    type: multiline ? null : "text",
    disabled: store.readonly,
  });
  el.addEventListener("input", () => setVal(key, el.value));
  bind(key, (v) => { if (document.activeElement !== el) el.value = v ?? def() ?? ""; });
  return el;
}

function scale(key, n, { tiers = false } = {}) {
  const btns = [];
  const wrap = h("div", { class: "scale", role: "group" });
  for (let i = 1; i <= n; i++) {
    const tier = !tiers ? 0 : i >= 9 ? 2 : i >= 4 ? 1 : 0;
    const b = h("button", { type: "button", class: `sq tier${tier}`, "aria-label": String(i), disabled: store.readonly }, h("span", {}, i));
    b.addEventListener("click", () => setVal(key, (val(key) | 0) === i ? 0 : i));
    btns.push(b);
    wrap.append(b);
  }
  bind(key, (v) => btns.forEach((b, i) => b.classList.toggle("on", (v | 0) > i)));
  return wrap;
}

const HEART_SVG = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 21s-7.5-4.6-9.6-9.2C.7 8 3 4 6.8 4c2 0 3.7 1.1 5.2 3 1.5-1.9 3.2-3 5.2-3 3.8 0 6.1 4 4.4 7.8C19.5 16.400 12 21 12 21z"/></svg>';
function hearts(key, n, cls = "") {
  const btns = [];
  const wrap = h("div", { class: `hearts ${cls}`, role: "group" });
  for (let i = 1; i <= n; i++) {
    const b = h("button", { type: "button", class: "heart", "aria-label": `${i} з ${n}`, html: HEART_SVG, disabled: store.readonly });
    b.addEventListener("click", () => setVal(key, (val(key) | 0) === i ? 0 : i));
    btns.push(b);
    wrap.append(b);
  }
  bind(key, (v) => btns.forEach((b, i) => b.classList.toggle("on", (v | 0) > i)));
  return wrap;
}

function chip(key, label, emoji, cls = "") {
  const b = h("button", { type: "button", class: `chip ${cls}`, disabled: store.readonly }, emoji && h("span", { class: "em" }, emoji), label);
  b.addEventListener("click", () => setVal(key, !val(key)));
  bind(key, (v) => { b.classList.toggle("on", !!v); b.setAttribute("aria-pressed", !!v); });
  return b;
}

function emojiToggle(key, emoji, title) {
  const b = h("button", { type: "button", class: "emo", title, "aria-label": title, disabled: store.readonly }, emoji);
  b.addEventListener("click", () => setVal(key, !val(key)));
  bind(key, (v) => { b.classList.toggle("on", !!v); b.setAttribute("aria-pressed", !!v); });
  return b;
}

function roseSwitch(key) {
  const b = h("button", { type: "button", class: "switch", role: "switch", "aria-label": "Отримала троянду", title: "Отримала троянду", disabled: store.readonly }, h("i", {}));
  b.addEventListener("click", () => setVal(key, !val(key)));
  bind(key, (v) => { b.classList.toggle("on", !!v); b.setAttribute("aria-checked", !!v); });
  return b;
}

/** лічильник «паличка щоразу, коли…» з + / − */
function tally(key, title, sub) {
  const marks = h("div", { class: "tally-marks", "aria-hidden": "true" });
  const num = h("b", { class: "tally-num" }, "0");
  const minus = h("button", { type: "button", class: "step minus", "aria-label": "Мінус", disabled: store.readonly }, "−");
  const plus = h("button", { type: "button", class: "step plus", "aria-label": "Плюс", disabled: store.readonly }, "+");
  minus.addEventListener("click", () => setVal(key, Math.max(0, (val(key) | 0) - 1)));
  plus.addEventListener("click", () => setVal(key, (val(key) | 0) + 1));
  bind(key, (v) => {
    const n = v | 0;
    num.textContent = n;
    marks.replaceChildren();
    const shown = Math.min(n, 50);
    for (let g = 0; g < Math.ceil(shown / 5); g++) {
      const c = Math.min(5, shown - g * 5);
      const grp = h("span", { class: `grp${c === 5 ? " full" : ""}` });
      for (let i = 0; i < Math.min(c, 4); i++) grp.append(h("i"));
      marks.append(grp);
    }
  });
  return h("div", { class: "card tally" },
    h("div", { class: "tally-title" }, title),
    h("div", { class: "tally-sub" }, sub),
    h("div", { class: "tally-box" }, marks),
    h("div", { class: "tally-ctl" }, minus, num, plus));
}

/* ───────── загальні шматки сторінок ───────── */
function pageHead({ tags, title, script, desc, label }) {
  return h("header", { class: "phead" },
    h("div", { class: "phead-top" },
      h("div", { class: "tags" },
        h("span", { class: "tag solid" }, "ХОЛОСТЯК 15"),
        h("span", { class: "tag" }, "ВИПУСК 01"),
        tags.map((t) => h("span", { class: "tag" }, t))),
      label),
    h("h1", {}, h("span", {}, title[0]), h("span", { class: "red" }, title[1]),
      script && h("em", { class: "script" }, script)),
    desc && h("p", { class: "desc" }, desc));
}

const expertLabel = () => h("label", { class: "plabel" }, "експерт",
  textField("expert", { def: () => playerName(store.viewing), cls: "expert" }));

function pageFoot(n, next) {
  return h("footer", { class: "pfoot" },
    h("span", {}, `КАРТА ЕКСПЕРТА · ХОЛОСТЯК 15 · ${n}/5`),
    next && h("button", { type: "button", class: "script next", onclick: () => go(n + 1) }, next));
}

/* ───────── сторінка 1: карта експерта ───────── */
function page1() {
  const stats = h("div", { class: "stats" },
    h("div", { class: "stats-head" }, h("b", {}, "Статистика гравця"), h("em", { class: "script" }, "зафарбуй 1–10")),
    HER_STATS.map(([name, sub], i) =>
      h("div", { class: "stat" },
        h("div", { class: "stat-name" }, name, sub && h("small", {}, sub)),
        scale(`st_${i}`, 10))));

  const player = h("div", { class: "player" },
    h("div", { class: "player-photo" }, h("img", { src: "assets/kravtsov.jpg", alt: "В’ячеслав Кравцов", onerror: (e) => e.target.remove() })),
    h("div", { class: "player-name" }, "В’ЯЧЕСЛАВ", h("br"), "КРАВЦОВ"),
    h("div", { class: "player-sub" }, "39 років · екс-НБА · капітан збірної"),
    h("div", { class: "player-tags" }, h("span", {}, "ПОЗИЦІЯ: ХОЛОСТЯК"), h("span", {}, "ЗРІСТ: ДУЖЕ")));

  return h("section", { class: "page" },
    pageHead({
      tags: ["16.10"], title: ["КАРТА", "ЕКСПЕРТА"], script: "сезон, де оцінюємо всіх",
      desc: "Цього разу під прицілом не лише дівчата. Спершу — сам холостяк. Обводь, зафарбовуй, рахуй палички.",
      label: expertLabel(),
    }),
    h("div", { class: "hero" }, player, stats),
    h("div", { class: "sect" }, h("h2", {}, "ЙОГО ВАЙБ"), h("em", { class: "script" }, "обведи все, що бачиш")),
    h("div", { class: "chips" }, HIS_VIBES.map(([e, t], i) => chip(`hv_${i}`, t, e))),
    h("div", { class: "sect" }, h("h2", {}, "ЛІЧИЛЬНИК"), h("em", { class: "script" }, "паличка щоразу, коли…")),
    h("div", { class: "tallies" }, TALLIES.map(([t, s], i) => tally(`tl_${i}`, t, s))),
    h("div", { class: "two" },
      h("div", { class: "card pink" }, h("h3", {}, "🚩 Ред флаги"), textField("red", { multiline: true, rows: 3, ph: "що насторожило…" })),
      h("div", { class: "card grn" }, h("h3", {}, "💚 Грін флаги"), textField("green", { multiline: true, rows: 3, ph: "що сподобалось…" }))),
    h("div", { class: "card bet verdict" }, h("h3", { class: "red" }, "⚖️ Вердикт"), textField("verdict", { multiline: true, rows: 3, ph: "підсумок про холостяка…" })),
    pageFoot(1, "далі — дівчата →"));
}

/* ───────── сторінки 2–3: учасниці ───────── */
const VIBE_LEGEND = h("div", { class: "legend" },
  h("b", { class: "red" }, "ВАЙБ — ОБВЕДИ"),
  VIBES.map(([e, t]) => h("span", {}, h("span", { class: "em" }, e), " ", t)));

function contestant(num) {
  const id = String(num).padStart(2, "0");
  const k = (s) => `c${id}_${s}`;
  const card = h("article", { class: "card girl" },
    h("div", { class: `num${(num - 1) % 3 === 1 ? " red" : ""}` }, id),
    h("label", { class: "row" }, h("span", { class: "lbl" }, "ІМ’Я"), textField(k("name"))),
    h("label", { class: "row" }, h("span", { class: "lbl red" }, "ЯК МИ НАЗВЕМ"), textField(k("nick"))),
    h("div", { class: "emos" }, VIBES.map(([e, t], i) => emojiToggle(k(`v${i}`), e, t))),
    textField(k("note"), { multiline: true, rows: 2, ph: "нотатки…", cls: "dashed" }),
    h("div", { class: "girl-foot" },
      hearts(k("hearts"), 5, "sm"),
      roseSwitch(k("rose")),
      chip(k("out"), "ПІШЛА", "", "outline")));
  bind(k("out"), (v) => card.classList.toggle("gone", !!v));
  return card;
}

function girlsPage(from, to, cfg) {
  const grid = h("div", { class: "girls" });
  for (let n = from; n <= to; n++) grid.append(contestant(n));
  return h("section", { class: "page" },
    pageHead({ ...cfg, label: expertLabel() }),
    VIBE_LEGEND.cloneNode(true),
    grid,
    pageFoot(cfg.n, cfg.next));
}

/* ───────── сторінка 4: бінго ───────── */
function lineInfo(d) {
  const on = (i) => i === 12 || (d?.[`b_${i}`] | 0) > 0;
  let marked = 0;
  for (let i = 0; i < 25; i++) if (on(i)) marked++;
  const win = new Set();
  let lines = 0;
  for (let a = 0; a < 5; a++) {
    const row = [0, 1, 2, 3, 4].map((c) => a * 5 + c);
    const col = [0, 1, 2, 3, 4].map((r) => r * 5 + a);
    for (const set of [row, col]) if (set.every(on)) { lines++; set.forEach((i) => win.add(i)); }
  }
  return { marked, lines, win };
}

function page4() {
  const cells = [];
  const board = h("div", { class: "bingo" });
  BINGO.forEach(([text, emoji, tone], i) => {
    if (i === 12) {
      board.append(h("div", { class: "bcell free" }, h("span", { class: "em" }, "🌹"), h("b", {}, BINGO_FREE)));
      cells.push(null);
      return;
    }
    const key = `b_${i}`;
    const cell = h("button", { type: "button", class: `bcell ${tone || ""}`, disabled: store.readonly },
      emoji && h("span", { class: "em" }, emoji),
      h("span", { class: "btxt" }, text),
      h("span", { class: "badge" }),
    );
    const minus = h("span", { class: "bminus", role: "button", "aria-label": "Відняти", title: "Відняти" }, "−");
    cell.append(minus);
    const dec = (e) => { e.preventDefault(); e.stopPropagation(); setVal(key, Math.max(0, (val(key) | 0) - 1)); };
    minus.addEventListener("click", dec);
    cell.addEventListener("contextmenu", dec);
    cell.addEventListener("click", () => setVal(key, (val(key) | 0) + 1));
    bind(key, (v) => {
      const n = v | 0;
      cell.classList.toggle("on", n > 0);
      $(".badge", cell).textContent = n > 1 ? `×${n}` : "";
      minus.hidden = n < 1 || store.readonly;
    });
    cells[i] = cell;
    board.append(cell);
  });

  const scorePill = h("span", { class: "scorepill" }, "0");
  const scoreNum = h("b", {}, "0");
  const linesNum = h("b", {}, "0");
  const board2 = h("div", { class: "board" });
  const score = h("div", { class: "scorebar" },
    h("div", { class: "score" }, "рахунок ", scoreNum, h("small", {}, " / 25")),
    h("div", { class: "score" }, "ліній ", linesNum),
    board2);
  let prevLines = null;
  bind("*", () => {
    const info = lineInfo(store.players[store.viewing]?.d);
    scoreNum.textContent = scorePill.textContent = info.marked;
    linesNum.textContent = info.lines;
    cells.forEach((c, i) => c && c.classList.toggle("win", info.win.has(i)));
    if (!store.readonly && prevLines !== null && info.lines > prevLines) toast("БІНГО! 🎉 Пиши в чат!");
    prevLines = info.lines;
    board2.replaceChildren(...Object.entries(store.players).map(([id, p]) => {
      const s = lineInfo(p.d);
      return h("span", { class: `pl${id === store.viewing ? " cur" : ""}` }, `${p.name || id}: ${s.marked}`, s.lines ? ` · ${s.lines} 🏁` : "");
    }));
  });

  return h("section", { class: "page" },
    pageHead({
      tags: ["ПІД ЧАС ПЕРЕГЛЯДУ"], title: ["БІНГО", "ВЕЧІРКИ"], script: "5 у ряд — пиши в чат",
      desc: "Закреслюй клітинку, щойно бачиш це на екрані. Тапни ще раз, якщо таке сталось знову (×2, ×3…). Хто перший зібрав лінію або стовпчик — той супер експерт сезону!!!!",
      label: h("div", { class: "plabel" }, "рахунок", scorePill),
    }),
    score, board,
    h("p", { class: "hint" }, "Тап — +1 · кнопка «−» (або правий клік) — мінус"),
    pageFoot(4, "підбиваємо підсумки →"));
}

/* ───────── сторінка 5: підсумки ───────── */
function page5() {
  const noms = h("div", { class: "noms" }, NOMINATIONS.map(([e, t, tone], i) =>
    h("label", { class: `card nom ${tone}` }, h("h3", {}, h("span", { class: "em" }, e), t), textField(`nom_${i}`))));

  const meter = h("div", { class: "card meter" }, scale("cringe", 10, { tiers: true }),
    h("div", { class: "meter-lbl" }, h("span", {}, "🙂 мило"), h("span", {}, "🫣 сховалась під плед"), h("span", {}, "🫨 вимкнула звук")));

  return h("section", { class: "page" },
    pageHead({
      tags: ["ПІСЛЯ ТИТРІВ"], title: ["ПІДСУМКИ", "& КРІНЖ"], script: "чесно, як у груповому чаті",
      label: expertLabel(),
    }),
    h("div", { class: "sect" }, h("h2", {}, "НОМІНАЦІЇ"), h("em", { class: "script" }, "одне ім’я — одна номінація?")),
    noms,
    h("div", { class: "sect" }, h("h2", {}, "КРІНЖ-МЕТР"), h("em", { class: "script" }, "наскільки бояче було дивитись")),
    meter,
    h("div", { class: "two" },
      h("div", { class: "card pink" }, h("h3", {}, h("span", { class: "em" }, "😬"), "Крінж випуску"), h("p", { class: "sub" }, "момент, який хочеться розбачити"), textField("moment", { multiline: true, rows: 3 })),
      h("div", { class: "card lav" }, h("h3", {}, h("span", { class: "em" }, "💬"), "Цитата вечора"), h("p", { class: "sub" }, "фраза, яку вже кидаємо в чат"), textField("quote", { multiline: true, rows: 3 }))),
    h("div", { class: "two" },
      h("label", { class: "card" }, h("h3", {}, h("span", { class: "em" }, "🤨"), "Лишилась, а за що?"), textField("stayed")),
      h("label", { class: "card" }, h("h3", {}, h("span", { class: "em" }, "🔥"), "Найкраща хімія з ним"), textField("chem"))),
    h("div", { class: "card bet" }, h("h3", { class: "red" }, h("span", { class: "em" }, "💍"), "Моя ставка на фінал"),
      h("p", { class: "sub" }, "Збережи картку. У фіналі перевіримо, хто тут справжній експерт"),
      h("div", { class: "bet-lines" }, textField("bet_0", { ph: "переможниця" }), textField("bet_1", { ph: "запасний варіант" }))),
    h("div", { class: "two wide" },
      h("div", { class: "card yel" }, h("h3", {}, h("span", { class: "em" }, "📺"), "Оцінка випуску"), h("p", { class: "sub" }, "зафарбуй сердечка"), hearts("rating", 10)),
      h("div", { class: "card" }, h("h3", {}, h("span", { class: "em" }, "🔮"), "Чекаю в наступному випуску"), textField("next", { multiline: true, rows: 2 }))),
    pageFoot(5, "до наступної п’ятниці ♡"));
}

/* ───────── рендер та навігація ───────── */
function buildPages() {
  return [
    page1(),
    girlsPage(1, 15, { n: 2, next: "ще не всі →", tags: ["УЧАСНИЦІ 01–15"], title: ["ХТО ВИЙШЛА", "З ЛІМУЗИНА"] }),
    girlsPage(16, 30, { n: 3, next: "граємо в бінго →", tags: ["УЧАСНИЦІ 16–30"], title: ["ЛІМУЗИНИ", "ЩЕ ЇДУТЬ"] }),
    page4(),
    page5(),
  ];
}

function render() {
  bindings.clear();
  const app = $("#app");
  app.classList.toggle("readonly", store.readonly);
  const pages = buildPages();
  pages.forEach((p, i) => { p.hidden = i + 1 !== page; });
  app.replaceChildren(...pages);
  renderTabs();
  renderPlayers();
}

function go(n) {
  page = Math.min(5, Math.max(1, n));
  [...$("#app").children].forEach((p, i) => { p.hidden = i + 1 !== page; });
  history.replaceState(null, "", `#p${page}`);
  renderTabs();
  scrollTo({ top: 0, behavior: "smooth" });
}

function renderTabs() {
  $("#tabs").replaceChildren(...PAGES.map(([short, long], i) =>
    h("button", { type: "button", class: "tab", "aria-current": i + 1 === page ? "page" : null, onclick: () => go(i + 1) },
      h("b", {}, i + 1), h("span", {}, short), h("small", {}, long))));
}

function renderPlayers() {
  const ids = Object.keys(store.players).sort((a, b) => (a === store.me ? -1 : b === store.me ? 1 : playerName(a).localeCompare(playerName(b))));
  $("#players").replaceChildren(...ids.map((id) =>
    h("button", { type: "button", class: `pchip${id === store.viewing ? " on" : ""}`, onclick: () => viewPlayer(id) },
      id === store.me ? `${playerName(id)} (я)` : playerName(id))));
  const banner = $("#banner");
  banner.hidden = !store.readonly;
  banner.replaceChildren(
    h("span", {}, `👀 Картка: ${playerName(store.viewing)} — тільки перегляд, оновлюється наживо`),
    h("button", { type: "button", onclick: () => viewPlayer(store.me) }, "← до моєї"));
}

function viewPlayer(id) {
  if (!store.players[id] || id === store.viewing) return;
  store.viewing = id;
  render();
}

function setStatus(mode) {
  const el = $("#status");
  const map = {
    local: ["local", "локально", "Синхронізація вимкнена — дані тільки в цьому браузері (див. README)"],
    connecting: ["wait", "підключення…", ""],
    online: ["ok", "наживо", "Синхронізовано"],
    offline: ["off", "офлайн", "Немає зв’язку — зміни збережуться локально й відправляться пізніше"],
    error: ["off", "помилка", "Не вдалось записати у Firebase — перевір правила бази (README)"],
  };
  const [cls, text, title] = map[mode];
  el.className = `status ${cls}`;
  el.title = title;
  $("span", el).textContent = text;
}

let toastTimer = null;
function toast(msg) {
  const el = $("#toast");
  el.textContent = msg;
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.hidden = true; }, 3500);
}

/* ───────── вхід / сесія ───────── */
function handlePlayers(remote) {
  const localD = store.players[store.me]?.d || {};
  const players = {};
  for (const [id, p] of Object.entries(remote)) players[id] = { name: p.name || id, d: p.d || {} };

  if (firstSnapshot) {
    firstSnapshot = false;
    // локальні (напр. офлайн) дані, яких ще немає в базі, піднімаємо наверх
    const mineRemote = players[store.me]?.d || {};
    for (const [k, v] of Object.entries(localD)) {
      if (!(k in mineRemote)) { mineRemote[k] = v; setTimeout(() => sync?.write(k, v), 0); }
    }
    players[store.me] = { name: players[store.me]?.name || store.players[store.me].name, d: mineRemote };
  }
  if (!players[store.me]) players[store.me] = { name: store.players[store.me].name, d: localD };

  const newcomers = Object.keys(players).join() !== Object.keys(store.players).join();
  store.players = players;
  if (!players[store.viewing]) store.viewing = store.me;
  if (newcomers) { render(); } else { refreshAll(); renderPlayers(); }
  persistLocal();
}

async function start(session) {
  firstSnapshot = true;
  sync?.flush?.();
  store.room = slug(session.room);
  store.me = slug(session.name);
  store.viewing = store.me;
  store.players = { [store.me]: { name: session.name.trim(), d: LS.get(`bingo.d.${store.room}.${store.me}`) || {} } };
  LS.set("bingo.session", session);
  render();
  try {
    sync = await createSync({
      room: store.room, id: store.me, name: session.name.trim(),
      onPlayers: handlePlayers, onStatus: setStatus,
    });
  } catch (e) {
    console.error(e);
    sync = null;
    setStatus("error");
  }
}

function openJoin() {
  const s = LS.get("bingo.session");
  const param = new URLSearchParams(location.search).get("room");
  $("#roomInput").value = param || s?.room || `roza-${Math.floor(1000 + Math.random() * 9000)}`;
  $("#nameInput").value = s?.name || "";
  $("#joinDlg").showModal();
  $("#nameInput").focus();
}

$("#joinForm").addEventListener("submit", () => {
  start({ room: $("#roomInput").value.trim(), name: $("#nameInput").value.trim() });
});
$("#joinDlg").addEventListener("cancel", (e) => { if (!store.me) e.preventDefault(); });

$("#menuBtn").addEventListener("click", () => {
  $("#menuInfo").textContent = `Кімната: ${store.room} · Ти: ${playerName(store.me)}${hasFirebase ? "" : " · синхронізація вимкнена"}`;
  $("#menuDlg").showModal();
});
$("#closeMenuBtn").addEventListener("click", () => $("#menuDlg").close());
$("#changeBtn").addEventListener("click", () => { $("#menuDlg").close(); openJoin(); });
$("#copyLinkBtn").addEventListener("click", async () => {
  const url = `${location.origin}${location.pathname}?room=${encodeURIComponent(store.room)}`;
  try { await navigator.clipboard.writeText(url); toast("Посилання скопійовано 📋"); } catch { prompt("Скопіюй посилання:", url); }
  $("#menuDlg").close();
});
$("#resetBtn").addEventListener("click", async () => {
  if (!confirm("Точно очистити всю твою картку? Це не можна скасувати.")) return;
  store.players[store.me].d = {};
  persistLocal();
  await sync?.clear();
  store.viewing = store.me;
  render();
  $("#menuDlg").close();
});

addEventListener("hashchange", () => {
  const n = Number((location.hash.match(/p(\d)/) || [])[1]);
  if (n && n !== page) go(n);
});

const saved = LS.get("bingo.session");
if (saved?.room && saved?.name) start(saved); else openJoin();
