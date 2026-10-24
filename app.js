/* DSH REMOTE — фронт чата. Ванильный JS, без сборки. */
"use strict";

const tg = window.Telegram && window.Telegram.WebApp ? window.Telegram.WebApp : null;

/* ---------- веб-авторизация и адрес бэкенда (веб-версия) ---------- */
const TOKEN_HASH = "e5a171a04b3ba5f5870d9d14c1f2cbfc1f6eb661faf9c5243693b3591a198079";
const TOKEN_KEY = "dsh_token";
const DEVICE_KEY = "dsh_dev";
const SERVER_KEY = "dsh_server_manual";

function isTG() { return !!(tg && tg.initData); }
function webToken() { try { return localStorage.getItem(TOKEN_KEY) || ""; } catch (e) { return ""; } }
function deviceToken() { try { return localStorage.getItem(DEVICE_KEY) || ""; } catch (e) { return ""; } }
function manualServer() { try { return localStorage.getItem(SERVER_KEY) || ""; } catch (e) { return ""; } }

function apiBase() {
  const manual = manualServer().trim();
  if (manual) return manual.replace(/\/+$/, "");
  const auto = String(window.DSH_BACKEND || "").trim();
  if (auto) return auto.replace(/\/+$/, "");
  return ""; // тот же origin: локальный сервер / TG
}

function logout() {
  const dev = deviceToken();
  try { localStorage.removeItem(TOKEN_KEY); localStorage.removeItem(DEVICE_KEY); } catch (e) {}
  /* сервер: забыть это устройство */
  try {
    fetch(apiBase() + "/api/device/logout", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ deviceToken: dev }),
    }).catch(() => {});
  } catch (e) {}
  syncSWAuth(true);
  location.replace("index.html");
}

/* заголовки авторизации: TG -> initData, веб -> токен устройства/ключ */
function authHeaders(json) {
  const h = {};
  if (json) h["Content-Type"] = "application/json";
  if (isTG()) h["X-Telegram-Init-Data"] = tg.initData;
  else if (deviceToken()) h["X-Device-Token"] = deviceToken();
  else h["X-App-Token"] = webToken();
  return h;
}

async function sha256Hex(s) {
  const b = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, "0")).join("");
}

/* гейт: в вебе без ключа/токена устройства — на страницу входа; в TG не нужен */
if (!isTG() && !webToken() && !deviceToken()) { location.replace("index.html"); throw new Error("unauthorized"); }

/* ---------- точная высота вьюпорта (холодный старт iOS) ----------
   До первого тапа 100dvh в standalone-PWA может отдать высоту без нижнего
   инсета — снизу вылезает чёрная полоса. Берём честную высоту из
   visualViewport и обновляем на ресайз/клавиатуру. */
function fitViewport() {
  const vv = window.visualViewport;
  if (vv) {
    if (vv.height > 0) {
      document.documentElement.style.setProperty("--app-h", Math.round(vv.height) + "px");
    }
    /* iOS смещает визуальный вьюпорт при клавиатуре — гасим смещение */
    if (document.body) {
      document.body.style.transform = vv.offsetTop
        ? "translateY(" + (-Math.round(vv.offsetTop)) + "px)" : "";
    }
  } else {
    document.documentElement.style.setProperty("--app-h", window.innerHeight + "px");
  }
  /* iOS проскролливает документ под фокус — документ прибит, возвращаем */
  if (window.scrollY || window.scrollX) window.scrollTo(0, 0);
}
fitViewport();
setTimeout(fitViewport, 300);
setTimeout(fitViewport, 1200);
addEventListener("resize", fitViewport);
addEventListener("scroll", fitViewport, { passive: true });
document.addEventListener("focusin", fitViewport);
if (window.visualViewport) {
  visualViewport.addEventListener("resize", fitViewport);
  visualViewport.addEventListener("scroll", fitViewport);
}

/* ---------- Telegram init ---------- */
/* Отступ сверху: статус-бар + нативная шапка Telegram (пока нет фуллскрина).
   CSS забирает максимум из env(safe-area-inset-top) и --tg-safe. */
function updateTopInset() {
  if (!tg) return;
  const sa = (tg.safeAreaInset && tg.safeAreaInset.top) || 0;
  const cs = (tg.contentSafeAreaInset && tg.contentSafeAreaInset.top) || 0;
  document.documentElement.style.setProperty("--tg-safe", Math.max(0, sa + cs) + "px");
}

function tgFullscreen() {
  if (!tg) return;
  try {
    if (!tg.isFullscreen && typeof tg.requestFullscreen === "function") {
      tg.requestFullscreen();
    }
  } catch (e) {}
}

function tgInit() {
  if (!tg) return;
  try { tg.ready(); } catch (e) {}
  try { tg.expand(); } catch (e) {}
  try { tg.setHeaderColor("#04060c"); } catch (e) {}
  try { tg.setBackgroundColor("#04060c"); } catch (e) {}
  try { tg.disableVerticalSwipes && tg.disableVerticalSwipes(); } catch (e) {}
  updateTopInset();
  tgFullscreen();
  /* часть клиентов не даёт фуллскрин мгновенно или требует жест — повторяем */
  setTimeout(tgFullscreen, 700);
  setTimeout(tgFullscreen, 2000);
  document.addEventListener("pointerdown", function once() {
    document.removeEventListener("pointerdown", once);
    tgFullscreen();
  });
  for (const ev of ["safeAreaChanged", "contentSafeAreaChanged", "fullscreenChanged"]) {
    try { tg.onEvent(ev, updateTopInset); } catch (e) {}
  }
}
tgInit();

function haptic(kind) {
  /* троттлинг лёгких импульсов: частые тапы не должны лагать */
  if (kind === undefined) {
    const now = Date.now();
    if (now - haptic._last < 80) return;
    haptic._last = now;
  }
  try {
    if (!tg || !tg.HapticFeedback) return;
    if (kind === "ok") tg.HapticFeedback.notificationOccurred("success");
    else if (kind === "err") tg.HapticFeedback.notificationOccurred("error");
    else tg.HapticFeedback.impactOccurred("light");
  } catch (e) {}
}
haptic._last = 0;

/* ---------- helpers ---------- */
const $ = (s) => document.querySelector(s);
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({
  /* сущности конкатенацией: мост декодирует именованные "&xxx;" в исходнике */
  "&": "&" + "amp;",
  "<": "&" + "lt;",
  ">": "&" + "gt;",
  '"': "&" + "quot;",
  "'": "&" + "#39;",
}[c]));

function hhmm(ts) {
  const d = ts ? new Date(ts) : new Date();
  if (isNaN(d)) return "";
  const p = (n) => String(n).padStart(2, "0");
  return p(d.getHours()) + ":" + p(d.getMinutes());
}

/* время для списка сессий: сегодня -> ЧЧ:ММ, иначе ДД.ММ */
function fmtTime(ts) {
  if (!ts) return "";
  const d = new Date(ts);
  if (isNaN(d)) return "";
  const now = new Date();
  const p = (n) => String(n).padStart(2, "0");
  if (d.toDateString() === now.toDateString()) {
    return p(d.getHours()) + ":" + p(d.getMinutes());
  }
  return p(d.getDate()) + "." + p(d.getMonth() + 1);
}

function toast(text, bad) {
  const t = $("#toast");
  t.textContent = text;
  t.style.borderColor = bad ? "var(--err)" : "var(--gr)";
  t.style.color = bad ? "var(--err)" : "var(--gr)";
  t.style.boxShadow = bad ? "0 0 14px rgba(255,92,122,.35)" : "0 0 14px rgba(43,255,158,.35)";
  t.classList.add("show");
  clearTimeout(toast._t);
  toast._t = setTimeout(() => t.classList.remove("show"), 2200);
}

async function api(path, opts = {}) {
  const headers = Object.assign(authHeaders(!!opts.body), opts.headers || {});
  const res = await fetch(apiBase() + path, Object.assign({}, opts, { headers }));
  if ((res.status === 401 || res.status === 403) && !isTG()) { logout(); throw new Error("unauthorized"); }
  if (!res.ok) {
    let msg = "HTTP " + res.status;
    try { const j = await res.json(); if (j.error) msg = j.error; } catch (e) {}
    throw new Error(msg);
  }
  return res.json();
}

/* ---------- state ---------- */
const state = {
  sessions: [],      // [{id,title,preview,updated_at,model}]
  active: null,      // id активной сессии
  models: [],        // [{id,label}]
  asks: [],          // висящие подтверждения [{eventId,event,sessionId,request}]
  model: "",         // модель активной сессии
  streamingSids: new Set(), // чаты с НАШЕЙ отправкой в процессе (изоляция)
  abortCtl: null,
  histCache: {},     // {sid: последний /messages} — мгновенный рендер при смене
};

/* ---------- рендер чата ---------- */
function setEmpty(v) { $("#empty").style.display = v ? "" : "none"; }

/* markdown-картинки в тексте -> <img> (локальные пути — через прокси сервера) */
const MD_IMG = /!\[([^\]]*)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g;

function filexUrl(src, mt) {
  const key = src.startsWith("sha256:")
    ? "ref=" + encodeURIComponent(src)
    : "path=" + encodeURIComponent(src);
  return apiBase() + "/api/filex?" + key +
         "&token=" + encodeURIComponent(deviceToken() || webToken()) +
         (mt ? "&mt=" + encodeURIComponent(mt) : "");
}

function fillText(el, text) {
  el.textContent = "";
  if (!text) return;
  const plain = !isTG() && !!(deviceToken() || webToken());  // прокси доступен
  let last = 0, m;
  MD_IMG.lastIndex = 0;
  while ((m = MD_IMG.exec(text)) !== null) {
    if (m.index > last) el.appendChild(document.createTextNode(text.slice(last, m.index)));
    const src = m[2];
    const img = document.createElement("img");
    img.className = "chat-img";
    img.alt = m[1] || "";
    img.loading = "lazy";
    img.src = (/^https?:\/\//i.test(src) || !plain)
      ? src
      : filexUrl(src, "");
    img.addEventListener("click", () => { try { window.open(img.src, "_blank"); } catch (e) {} });
    el.appendChild(img);
    last = m.index + m[0].length;
  }
  if (last < text.length) el.appendChild(document.createTextNode(text.slice(last)));
}

function addMsg(role, text, ts, cls, atts) {
  setEmpty(false);
  const el = document.createElement("div");
  el.className = "msg " + (cls || (role === "user" ? "me" : "agent"));
  const who = role === "user" ? "ВЫ" : "DSH";
  el.innerHTML = '<div class="meta">' + who + " · " + hhmm(ts) + "</div>" +
                 '<div class="text"></div>';
  fillText(el.querySelector(".text"), text || "");
  for (const a of atts || []) {
    if (a.kind === "image") {
      const img = document.createElement("img");
      img.className = "chat-img";
      img.alt = a.name || "";
      img.loading = "lazy";
      img.src = filexUrl(a.ref, a.mediaType);
      img.addEventListener("click", () => { try { window.open(img.src, "_blank"); } catch (e) {} });
      el.appendChild(img);
    } else if (a.kind === "file") {
      const link = document.createElement("a");
      link.className = "chat-file";
      link.target = "_blank";
      link.rel = "noopener";
      link.textContent = "📎 " + (a.name || "файл");
      link.href = filexUrl(a.ref, a.mediaType);
      el.appendChild(link);
    }
  }
  $("#msgs").appendChild(el);
  scrollBottom(true);
  return el;
}

function scrollBottom(force) {
  const m = $("#msgs");
  const near = m.scrollHeight - m.scrollTop - m.clientHeight < 60;
  if (near || force) m.scrollTop = m.scrollHeight;
}

function renderMessages(list) {
  const m = $("#msgs");
  m.innerHTML = '<div class="empty" id="empty"><div class="empty-logo">&#9638;&#9639;&#9638;</div>' +
    '<div>СЕССИЯ ПУСТА</div><div class="empty-hint">НАПИШИТЕ ПЕРВОЕ СООБЩЕНИЕ</div></div>';
  for (const item of list) addMsg(item.role, item.text, item.ts, null, item.atts);
  if (!list.length) setEmpty(true); else setEmpty(false);
}

/* ---------- сессии ---------- */
function sessTitle(s) { return s.title || "Новый чат"; }

function renderSessions() {
  updateLoadbar();
  updateTok();
  const box = $("#sess-list");
  const keepScroll = box.scrollTop;  // не сбрасывать скролл при перерисовке
  box.innerHTML = "";
  if (!state.sessions.length) {
    box.innerHTML = '<div class="empty" style="margin:20px auto">СЕССИЙ НЕТ<br>ЖМИ «+ НОВАЯ»</div>';
    return;
  }
  for (const s of state.sessions) {
    const el = document.createElement("div");
    el.className = "sess" + (s.id === state.active ? " active" : "");
    el.innerHTML =
      '<div class="s-top"><span class="s-title">' + esc(sessTitle(s)) + "</span>" +
      '<span class="s-time">' + esc(fmtTime(s.updated_at)) + "</span></div>" +
      '<div class="s-prev">' + esc(s.preview || "Нет сообщений") + "</div>" +
      '<div class="s-meta">' +
        (s.ask
          ? '<span class="s-ask">● ПОДТВЕРЖДЕНИЕ</span>'
          : (s.running ? '<span class="s-run">● РАБОТАЕТ</span>' : "")) +
        (s.running
          ? '<span class="minibar on"><i style="animation-delay:0s"></i>' +
            '<i style="animation-delay:.09s"></i><i style="animation-delay:.18s"></i>' +
            '<i style="animation-delay:.27s"></i><i style="animation-delay:.36s"></i>' +
            '<i style="animation-delay:.45s"></i><i style="animation-delay:.54s"></i>' +
            '<i style="animation-delay:.63s"></i><i style="animation-delay:.72s"></i></span>'
          : (s.model ? '<span class="s-model">' + esc(s.model) + "</span>" : "")) +
      "</div>";
    el.addEventListener("click", () => { closeDrawer(); openSession(s.id); haptic(); });
    box.appendChild(el);
  }
  box.scrollTop = keepScroll;
}

async function loadState(keepActive) {
  const st = await api("/api/state");
  state.sessions = st.sessions || [];
  state.models = st.models || [];
  if (!keepActive || !state.active) state.active = st.active || null;
  if (!keepActive) state.model = st.model || "";
  renderSessions();
  updateChip();
  updateConn(true);
}

async function openSession(id) {
  state.active = id;
  const myOpen = ++openSeq;
  $("#alog-lines").innerHTML = "";  // лог агента — свой у каждого чата
  const cached = state.histCache[id];
  if (cached) {  // мгновенный рендер из кэша, свежие данные догружаются
    renderMessages(cached.messages || []);
    state.model = cached.model || state.model;
    updateChip(); renderSessions(); updateTok(); renderAsks();
  }
  try {
    const r = await api("/api/sessions/" + encodeURIComponent(id) + "/messages");
    if (myOpen !== openSeq) return;  // пока грузилась история, переключились
    state.histCache[id] = r;
    const keys = Object.keys(state.histCache);
    if (keys.length > 12) delete state.histCache[keys[0]];
    renderMessages(r.messages || []);
    state.model = r.model || "";
    updateChip();
    renderSessions();
    updateTok();
    renderAsks();
    wsSend({ t: "sub", sid: id });
  } catch (e) {
    if (!cached) toast("НЕ УДАЛОСЬ ЗАГРУЗИТЬ: " + e.message, true);
  }
}

let openSeq = 0;

async function newSession() {
  try {
    let sid;
    if (conn.open) {
      const r = await wsCall({ t: "new" });
      if (!r.ok) throw new Error(r.error || "ошибка");
      sid = r.sid;
    } else {
      const r = await api("/api/sessions", { method: "POST", body: JSON.stringify({}) });
      sid = r.session && r.session.id;
    }
    haptic("ok");
    await loadState(true);
    if (sid) await openSession(sid);
    closeDrawer();
    $("#inp").focus();
  } catch (e) { toast("ОШИБКА СОЗДАНИЯ: " + e.message, true); }
}

/* ---------- модели ---------- */
function updateChip() {
  const el = $("#model-name");
  if (!el) return; // чип заменён ретро-лоадбаром
  const s = state.sessions.find((x) => x.id === state.active);
  el.textContent = state.model || (s && s.model) || "МОДЕЛЬ";
}

function renderModels() {
  const box = $("#model-list");
  /* перестраиваем только при реальном изменении — иначе сбрасывается скролл */
  const sig = JSON.stringify([state.models, state.model]);
  if (modelsSig === sig) return;
  const keep = box.scrollTop;
  box.innerHTML = "";
  for (const m of state.models) {
    const row = document.createElement("button");
    row.type = "button";
    row.className = "mrow" + (m.id === state.model ? " sel" : "");
    row.innerHTML = '<span class="mk">' + (m.id === state.model ? "✓" : "·") + "</span>" +
      "<span>" + esc(m.label || m.id) + "</span>" +
      (m.desc ? '<span class="m-desc">' + esc(m.desc) + "</span>" : "");
    row.dataset.mid = m.id;
    row.addEventListener("click", async () => {
      try {
        if (conn.open) {
          const r = await wsCall({ t: "model", sid: state.active, model: m.id });
          if (!r.ok) throw new Error(r.error || "ошибка");
        } else {
          await api("/api/sessions/" + encodeURIComponent(state.active) + "/model",
            { method: "POST", body: JSON.stringify({ model: m.id }) });
        }
        state.model = m.id;
        renderModels(); updateChip(); renderSessions();
        closeSheet(); haptic("ok"); toast("МОДЕЛЬ: " + (m.label || m.id));
      } catch (e) { haptic("err"); toast("ОШИБКА: " + e.message, true); }
    });
    box.appendChild(row);
  }
  box.scrollTop = keep;
}
let modelsSig = null;

/* ---------- отправка / стриминг ---------- */
/* занятость ПЕР-ЧАТУ: чаты полностью изолированы */
function setSessionBusy(sid, v) {
  if (v) state.streamingSids.add(sid);
  else state.streamingSids.delete(sid);
  updateLoadbar();
  if (sid === state.active) {
    const agentBubble = document.querySelector(".msg.agent.live");
    if (agentBubble) agentBubble.classList.toggle("busy-pulse", v);
  }
}

function liveAgentBubble() {
  let el = document.querySelector(".msg.agent.live");
  if (!el) {
    el = addMsg("agent", "");
    el.classList.add("live");
    el.querySelector(".text").innerHTML = '<span class="cursor"></span>';
  }
  return el;
}

async function send() {
  if (state.streamingSids.has(state.active)) { stop(); return; }
  const inp = $("#inp");
  const text = inp.value.trim();
  if (!text) return;
  if (!state.active) { toast("СНАЧАЛА СОЗДАЙ СЕССИЮ", true); openDrawer(); return; }
  inp.value = ""; autosize();
  addMsg("user", text);
  haptic();
  const sid = state.active;
  if (conn.open) {
    const req = "s" + (++conn.reqN);
    sendCtxByReq[req] = { sid, full: "" };
    setSessionBusy(sid, true);
    wsSend({ t: "send", sid, text, req });
    return;
  }
  setSessionBusy(sid, true);
  const ctl = new AbortController();
  state.abortCtl = ctl;
  try {
    const res = await fetch(apiBase() + "/api/sessions/" + encodeURIComponent(sid) + "/send", {
      method: "POST", headers: authHeaders(true), body: JSON.stringify({ text }), signal: ctl.signal,
    });
    if (!res.ok || !res.body) {
      let msg = "HTTP " + res.status;
      try { const j = await res.json(); if (j.error) msg = j.error; } catch (e) {}
      throw new Error(msg);
    }
    let full = "";
    await readSSE(res, (ev) => {
      if (ev.type === "delta" && ev.text) {
        full += ev.text;
        if (state.active === sid) {  // рисуем только если чат открыт
          const el = liveAgentBubble();
          el.querySelector(".text").textContent = full;
          scrollBottom();
        }
      } else if (ev.type === "done") {
        if (state.active === sid) {
          const el = document.querySelector(".msg.agent.live");
          if (el) { el.classList.remove("live", "busy-pulse"); if (!full) el.querySelector(".text").textContent = ev.text || "(пусто)"; }
        }
        full = "";
      } else if (ev.type === "error") {
        throw new Error(ev.message || "ошибка агента");
      }
    });
    haptic("ok");
  } catch (e) {
    if (e.name === "AbortError") toast("ОСТАНОВЛЕНО");
    else { addMsg("error", "⚠ " + e.message, null, "err-msg"); haptic("err"); }
  } finally {
    setSessionBusy(sid, false);
    state.abortCtl = null;
    loadState(true).catch(() => {}); // обновить превью сессий
  }
}

async function stop() {
  if (conn.open) { wsSend({ t: "stop", sid: state.active }); return; }
  if (state.abortCtl) state.abortCtl.abort();
  try {
    await api("/api/sessions/" + encodeURIComponent(state.active) + "/stop", { method: "POST" });
  } catch (e) {}
}

/* ---------- чтение SSE-стрима (send / attach) ---------- */
async function readSSE(res, onEv) {
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let idx;
    while ((idx = buf.indexOf("\n\n")) >= 0) {
      const raw = buf.slice(0, idx); buf = buf.slice(idx + 2);
      for (const line of raw.split("\n")) {
        if (!line.startsWith("data:")) continue;
        let ev; try { ev = JSON.parse(line.slice(5).trim()); } catch (e) { continue; }
        onEv(ev);
      }
    }
  }
}

/* ---------- файлы и фото: лонг-пресс ⌨ (0.5с) -> пикер iOS ---------- */
async function sendFile(f) {
  if (!state.active) { toast("СНАЧАЛА СОЗДАЙ СЕССИЮ", true); openDrawer(); return; }
  if (f.size > 25 * 1024 * 1024) { toast("ФАЙЛ БОЛЬШЕ 25 МБ", true); return; }
  const sid = state.active;
  addMsg("user", "📎 " + f.name + " · " + Math.max(1, Math.round(f.size / 1024)) + " КБ");
  haptic();
  setSessionBusy(sid, true);
  try {
    const res = await fetch(apiBase() + "/api/sessions/" + encodeURIComponent(sid) +
      "/attach?name=" + encodeURIComponent(f.name),
      { method: "POST", headers: authHeaders(false), body: f });
    if (!res.ok || !res.body) {
      let msg = "HTTP " + res.status;
      try { const j = await res.json(); if (j.error) msg = j.error; } catch (e) {}
      throw new Error(msg);
    }
    let full = "";
    await readSSE(res, (ev) => {
      if (ev.type === "delta" && ev.text) {
        full += ev.text;
        if (state.active === sid) {
          const el = liveAgentBubble();
          el.querySelector(".text").textContent = full;
          scrollBottom();
        }
      } else if (ev.type === "done") {
        if (state.active === sid) {
          const el = document.querySelector(".msg.agent.live");
          if (el) { el.classList.remove("live", "busy-pulse"); if (!full) el.querySelector(".text").textContent = "(принято)"; }
        }
        full = "";
      } else if (ev.type === "error") {
        throw new Error(ev.message || "ошибка загрузки файла");
      }
    });
    haptic("ok");
  } catch (e) {
    addMsg("error", "⚠ " + e.message, null, "err-msg");
    haptic("err");
  } finally {
    setSessionBusy(sid, false);
    loadState(true).catch(() => {});
  }
}

/* ---------- drawer / sheet ---------- */
function openDrawer() {
  $("#drawer").classList.add("open"); $("#scrim").classList.add("show");
  renderSessions(); backShow();
}
function closeDrawer() {
  $("#drawer").classList.remove("open");
  if (!$("#sheet").classList.contains("open")) { $("#scrim").classList.remove("show"); backShow(); }
}
function openSheet() {
  if (!state.models.length) { toast("СПИСОК МОДЕЛЕЙ ПУСТ", true); return; }
  renderModels();
  $("#sheet").classList.add("open"); $("#scrim").classList.add("show"); backShow();
}
function closeSheet() {
  $("#sheet").classList.remove("open");
  if (!$("#drawer").classList.contains("open")) { $("#scrim").classList.remove("show"); backShow(); }
}
function backShow() {
  if (!tg || !tg.BackButton) return;
  const open = $("#drawer").classList.contains("open") || $("#sheet").classList.contains("open");
  try { open ? tg.BackButton.show() : tg.BackButton.hide(); } catch (e) {}
}

function updateConn(ok, text) {
  $("#conn-dot").className = "dot " + (ok ? "on" : "err");
  $("#conn-text").textContent = text || (ok ? "DSH НА СВЯЗИ" : "НЕТ СВЯЗИ С DSH");
}

/* ---------- клавиатура: нативная, только через кнопку ⌨ ----------
   Поле держится readonly: тап по нему никогда не поднимает клавиатуру.
   Кнопка снимает readonly и фокусирует поле в жесте пользователя —
   клавиатура поднимается; повторный тап — blur и возврат readonly. */
let kbUp = false;
const inpEl = $("#inp");
inpEl.addEventListener("focus", () => { kbUp = true; });
inpEl.addEventListener("blur", () => { kbUp = false; inpEl.readOnly = true; });

function kbOpen() {
  inpEl.blur();           // сброс, чтобы фокус точно переустановился
  inpEl.readOnly = false; // сняли readonly — focus поднимает клавиатуру
  inpEl.focus();
}

function kbClose() {
  inpEl.blur();
  inpEl.readOnly = true;
}

/* ---------- ретро-лоадбар: харнес занят? ---------- */
function updateLoadbar() {
  /* лоадбар отражает работу только в ОТКРЫТОМ диалоге;
     работа в других чатах видна минибаром в их карточках */
  const s = activeSession();
  const busy = (s && state.streamingSids.has(s.id)) || !!(s && s.running);
  const bar = $("#loadbar");
  if (bar) {
    bar.classList.toggle("on", busy);
    bar.classList.toggle("hidden", !busy); /* вне работы полосы нет */
  }
  updateSendBtn();
  const alog = $("#alog");
  if (alog) {
    /* показываем ТОЛЬКО текущую работу; завершилось — скрыли и очистили */
    const show = busy && $("#alog-lines").children.length > 0;
    alog.classList.toggle("hidden", !show);
    if (!busy) $("#alog-lines").innerHTML = "";
  }
}

/* кнопка отправки/остановки: следит и за своей отправкой, и за ходом
   агента в активной сессии (задача может быть запущена с ПК) */
function activeSession() {
  return state.sessions.find((x) => x.id === state.active);
}

function updateSendBtn() {
  const s = activeSession();
  const busy = (s && state.streamingSids.has(s.id)) || !!(s && s.running);
  const btn = $("#btn-send");
  btn.classList.toggle("stop", busy);
  btn.innerHTML = busy ? "&#9632;" : "&#9654;";
}

/* токены активной сессии в шапке */
function fmtTok(n) {
  if (!n) return "";
  if (n >= 1e6) return (n / 1e6).toFixed(1) + "M";
  if (n >= 1e3) return (n / 1e3).toFixed(1) + "k";
  return String(n);
}

function updateTok() {
  const el = $("#tok");
  if (!el) return;
  const s = activeSession();
  el.textContent = s && s.tokens ? fmtTok(s.tokens) + " tok" : "";
}

/* панель внутреннего лога агента над полем ввода */
function logLine(text) {
  if (!text) return;
  const box = $("#alog");
  const lines = $("#alog-lines");
  const el = document.createElement("div");
  el.textContent = text;
  lines.appendChild(el);
  while (lines.children.length > 2) lines.removeChild(lines.firstChild);  // только текущая работа
  lines.scrollTop = lines.scrollHeight;
  const s = activeSession();
  if (s && (state.streamingSids.has(s.id) || s.running)) {
    box.classList.remove("hidden");
  }
}

/* ---------- подтверждения (waterfall-запросы DSH) ---------- */
function showAsk(ev) {
  resolveAsk(ev.eventId);
  const box = $("#asks");
  const card = document.createElement("div");
  card.className = "ask";
  card.id = "ask-" + ev.eventId;
  card.dataset.eid = ev.eventId;
  const req = ev.request || {};
  if (ev.event === "approval/request") {
    card.innerHTML =
      '<div class="ask-t">ПОДТВЕРЖДЕНИЕ · ' + esc(req.toolName || "?") + "</div>" +
      (req.reason ? '<div class="ask-d">' + esc(String(req.reason).slice(0, 220)) + "</div>" : "") +
      '<div class="ask-b">' +
      '<button class="btn primary" data-v="allowed-once">РАЗРЕШИТЬ</button>' +
      '<button class="btn stop" data-v="rejected">ЗАПРЕТИТЬ</button></div>';
  } else if (ev.event === "user-questions/request") {
    const qs = req.questions || [];
    /* раньше здесь было присваивание в необъявленную переменную — в strict-режиме
       креш и пустая карточка; заодно добавлен свой ответ текстом */
    card.innerHTML = qs.map((q) => {
      const opts = (q.options || []).map((o) => {
        const ans = JSON.stringify({ answers: [{ id: q.id, selected: [o.label], custom: "" }] });
        return '<button class="btn primary" data-answer="' + esc(ans) + '">' + esc(o.label) + "</button>";
      }).join("");
      const custom = '<div class="ask-c">' +
        '<input class="ask-inp" data-qid="' + esc(q.id) + '" placeholder="Свой ответ…" ' +
        'autocomplete="off" autocapitalize="off" spellcheck="false">' +
        '<button class="btn" data-custom="' + esc(q.id) + '">ОК</button></div>';
      return '<div class="ask-t">ВОПРОС' + (q.header ? " · " + esc(q.header) : "") + "</div>" +
        '<div class="ask-d">' + esc(q.question || "") + "</div>" +
        (opts ? '<div class="ask-b">' + opts + "</div>" : "") + custom;
    }).join("");
  } else {
    card.innerHTML =
      '<div class="ask-t">ЗАПРОС · ' + esc(ev.event || "?") + "</div>" +
      '<div class="ask-d"><pre class="term">' +
      esc(JSON.stringify(req, null, 1).slice(0, 400)) + "</pre></div>" +
      '<div class="ask-b"><button class="btn primary" data-next="1">ПРОПУСТИТЬ</button></div>';
  }
  card.querySelectorAll("button").forEach((b) => b.addEventListener("click", () => {
    haptic();
    let val = null;
    if (b.dataset.v !== undefined) val = b.dataset.v;
    else if (b.dataset.answer) { try { val = JSON.parse(b.dataset.answer); } catch (e) {} }
    else if (b.dataset.custom !== undefined) {
      const inp = [...card.querySelectorAll(".ask-inp")]
        .find((i) => i.dataset.qid === b.dataset.custom);
      const t = (inp && inp.value.trim()) || "";
      val = t ? { answers: [{ id: b.dataset.custom, selected: [], custom: t }] } : null;
    }
    answerAsk(ev.eventId, val);
  }));
  box.appendChild(card);
  box.classList.remove("hidden");
  haptic();
}

/* карточки подтверждений: показываем только для открытого чата,
   бейджи в списке — для всех; переживают переподключение (state.asks) */
function renderAsks() {
  const box = $("#asks");
  if (!box) return;
  const mine = state.asks.filter((a) => !a.sessionId || a.sessionId === state.active);
  const ids = new Set(mine.map((a) => a.eventId));
  [...box.children].forEach((c) => { if (!ids.has(c.dataset.eid)) c.remove(); });
  for (const a of mine) {
    if (!document.getElementById("ask-" + a.eventId)) showAsk(a);
  }
  if (box.children.length) box.classList.remove("hidden");
  else box.classList.add("hidden");
}

async function answerAsk(eventId, value) {
  try {
    if (conn.open) {
      const r = await wsCall({ t: "answer", eventId, value });
      if (!r.ok) throw new Error(r.error || "ошибка");
    } else {
      await api("/api/events/result", {
        method: "POST", body: JSON.stringify({ eventId, value }),
      });
    }
  } catch (e) { toast("ОТВЕТ НЕ ПРОШЁЛ: " + e.message, true); }
  resolveAsk(eventId);
}

function resolveAsk(eventId) {
  const el = document.getElementById("ask-" + eventId);
  if (el) el.remove();
  if (!$("#asks").children.length) $("#asks").classList.add("hidden");
}

/* ---------- транспорт: WS-мультиплексор + фолбэк-polling ----------
   WS несёт всё: стейт-диффы, live-события чата, подтверждения, действия.
   Сердцебиение держит NAT/эдж живым, seq+replay гарантируют доставку
   после разрыва. Если WS недоступен — опрос REST раз в 3с (конечные
   ответы через туннель проходят всегда). */
const conn = {
  ws: null, open: false, helloed: false, fails: 0,
  lastSeq: 0, lastAct: 0, reqN: 0, reqs: {},
  mode: "ws", pollTimer: null, lastWsTry: 0,
};
const sendCtxByReq = {}; /* req -> {sid, full} — изоляция стримов по чатам */

function wsSend(obj) {
  if (conn.open && conn.ws && conn.ws.readyState === 1) {
    try { conn.ws.send(JSON.stringify(obj)); } catch (e) {}
  }
}

function wsCall(payload) {
  return new Promise((resolve, reject) => {
    const req = "r" + (++conn.reqN);
    conn.reqs[req] = resolve;
    wsSend(Object.assign({ req }, payload));
    setTimeout(() => {
      if (conn.reqs[req]) { delete conn.reqs[req]; reject(new Error("таймаут")); }
    }, 25000);
  });
}

function handleEv(m) {
  conn.lastSeq = m.seq;
  if (m.ch === "state") {
    state.sessions = m.sessions || [];
    state.models = m.models || state.models;
    state.asks = m.asks || [];
    renderSessions(); renderAsks();
    if ($("#sheet").classList.contains("open")) renderModels();
  } else if (m.ch === "ask") {
    if (!state.asks.find((a) => a.eventId === m.eventId)) state.asks.push(m);
    renderAsks();
  } else if (m.ch === "cancel") {
    state.asks = state.asks.filter((a) => a.eventId !== m.eventId);
    renderAsks();
  }
}

function handleLive(m) {
  if (m.sid !== state.active) return;
  if (m.k === "msg") appendLive(m.role, m.text, m.ts);
  else if (m.k === "log") logLine(m.text);
}

function handleSendFrame(m) {
  const ctx = sendCtxByReq[m.req];
  if (!ctx) return;
  if (m.sid !== state.active) {
    /* стрим чужого (уже не открытого) чата — только учёт завершения */
    if (m.k === "done" || m.k === "error") delete sendCtxByReq[m.req];
    return;
  }
  if (m.k === "delta" && m.text) {
    ctx.full += m.text;
    const el = liveAgentBubble();
    el.querySelector(".text").textContent = ctx.full;
    scrollBottom();
  } else if (m.k === "done") {
    finishLiveBubble(); setSessionBusy(m.sid, false); haptic("ok");
  } else if (m.k === "error") {
    finishLiveBubble();
    addMsg("error", "⚠ " + (m.message || "ошибка агента"), null, "err-msg");
    setSessionBusy(m.sid, false); haptic("err");
  }
  if (m.k === "done" || m.k === "error") delete sendCtxByReq[m.req];
}

function handleRes(m) {
  const r = conn.reqs[m.req];
  if (r) { delete conn.reqs[m.req]; r(m); }
}

function finishLiveBubble() {
  const el = document.querySelector(".msg.agent.live");
  if (el) el.classList.remove("live", "busy-pulse");
}

function wsConnect() {
  if (conn.ws) { try { conn.ws.onclose = null; conn.ws.close(); } catch (e) {} }
  conn.lastWsTry = Date.now();
  conn.helloed = false;
  let ws;
  try {
    const qs = isTG()
      ? "init=" + encodeURIComponent(tg.initData || "")
      : "token=" + encodeURIComponent(deviceToken() || webToken());
    conn.base = apiBase();
    ws = new WebSocket(conn.base.replace(/^http/, "ws") + "/api/ws?" + qs +
                       "&last=" + (conn.lastSeq || 0));
  } catch (e) { scheduleRetry(); return; }
  conn.ws = ws;
  ws.onopen = () => { conn.open = true; conn.lastAct = Date.now(); };
  ws.onmessage = (e) => {
    let m; try { m = JSON.parse(e.data); } catch (err) { return; }
    conn.lastAct = Date.now();
    if (m.t === "hello") {
      conn.helloed = true; conn.fails = 0; exitFallback();
      updateConn(true);
      state.streamingSids.clear(); // стримы переживают разрыв на сервере
      if (state.active) {
        wsSend({ t: "sub", sid: state.active });
        openSession(state.active).catch(() => {});
      }
      loadState(true).catch(() => {});
    } else if (m.t === "hb") { conn.lastSeq = m.seq; }
    else if (m.t === "ev") handleEv(m);
    else if (m.t === "live") handleLive(m);
    else if (m.t === "send") handleSendFrame(m);
    else if (m.t === "res") handleRes(m);
    else if (m.t === "bye") { try { ws.close(); } catch (err) {} }
  };
  ws.onclose = () => {
    conn.open = false; conn.ws = null;
    if (conn.helloed) conn.fails = 0; else conn.fails++;
    finishLiveBubble();
    updateSendBtn(); updateLoadbar();
    if (conn.fails >= 3) enterFallback();
    scheduleRetry();
  };
  ws.onerror = () => { try { ws.close(); } catch (e) {} };
}

function scheduleRetry() {
  clearTimeout(conn._retry);
  const base = conn.fails ? Math.min(500 * Math.pow(2, Math.min(conn.fails, 6)), 30000) : 400;
  conn._retry = setTimeout(() => {
    if (document.visibilityState === "visible") wsConnect();
  }, base + Math.random() * base * 0.3);
}

/* watchdog: тишина >50с при открытом сокете — рвём и переподключаем */
setInterval(() => {
  if (conn.open && Date.now() - conn.lastAct > 50000) {
    try { conn.ws.close(4000, "stale"); } catch (e) {}
  }
}, 5000);

/* фолбэк: опрос конечных REST-ответов */
function enterFallback() {
  if (conn.mode === "poll") return;
  conn.mode = "poll";
  updateConn(false, "ОФЛАЙН-РЕЖИМ (ОПРОС)");
  if (maybeAutoHeal() && conn.base !== apiBase()) { conn.fails = 0; wsConnect(); return; }
  const tick = async () => {
    if (Date.now() - conn.lastWsTry > 60000) wsConnect();
    try {
      const st = await api("/api/state");
      state.sessions = st.sessions || [];
      state.models = st.models || state.models;
      state.asks = st.asks || [];
      renderSessions(); renderAsks();
      if (state.active) {
        const r = await api("/api/sessions/" + encodeURIComponent(state.active) + "/messages");
        for (const msg of (r.messages || [])) appendLive(msg.role, msg.text, msg.ts);
        if (r.model) { state.model = r.model; updateChip(); }
      }
      updateConn(true, "ОПРОС 3с");
    } catch (e) { updateConn(false, "НЕТ СВЯЗИ"); }
    clearTimeout(conn.pollTimer);
    conn.pollTimer = setTimeout(tick, 3000);
  };
  tick();
}

function exitFallback() {
  if (conn.mode !== "poll") return;
  conn.mode = "ws";
  clearTimeout(conn.pollTimer);
  conn.pollTimer = null;
}

function appendLive(role, text, ts) {
  if (!text || !text.trim() || !state.active) return;
  if (state.streamingSids.has(state.active)) return; // свой стрим уже рисует ответ
  const cls = role === "user" ? "me" : "agent";
  const bubbles = document.querySelectorAll("#msgs .msg." + cls);
  const last = bubbles.length ? bubbles[bubbles.length - 1].querySelector(".text") : null;
  if (last && last.textContent === text) return; // дубликат своего же сообщения
  addMsg(role, text, ts);
}

/* ---------- autosize textarea ---------- */
function autosize() {
  const t = $("#inp");
  /* рост текста меряем дёшево; усадка требует честного пересчёта */
  const len = t.value.length;
  if (len < autosize._len) t.style.height = "auto";
  autosize._len = len;
  t.style.height = Math.min(t.scrollHeight, 132) + "px";
  t.scrollTop = t.scrollHeight; /* автопрокрутка за курсором */
}
autosize._len = -1;

/* ---------- events ---------- */
$("#brand").addEventListener("click", openDrawer);   // десктоп-фолбэк
$("#loadbar").addEventListener("click", openSheet);  // десктоп-фолбэк
$("#btn-new").addEventListener("click", newSession);
$("#sheet-close").addEventListener("click", closeSheet);
$("#scrim").addEventListener("click", () => { closeDrawer(); closeSheet(); closeSet(); });
$("#btn-send").addEventListener("click", send);
/* кнопка отправки не забирает фокус — клавиатура не гаснет при отправке */
$("#btn-send").addEventListener("pointerdown", (e) => e.preventDefault());
const kbBtn = $("#kb-call");
let kbWasUp = false;
let lpTimer = null, lpFired = false;
kbBtn.addEventListener("pointerdown", (e) => {
  /* preventDefault: кнопка не забирает фокус, состояние поля стабильно */
  e.preventDefault();
  kbWasUp = document.activeElement === inpEl && kbUp && !inpEl.readOnly;
  lpFired = false;
  clearTimeout(lpTimer);
  /* лонг-пресс ≥0.5с — стандартный пикер iOS (фото/файлы) */
  lpTimer = setTimeout(() => {
    lpFired = true;
    haptic();
    try { $("#file-in").click(); } catch (err) {}
  }, 500);
});
["pointerup", "pointercancel", "pointerleave"].forEach((evn) =>
  kbBtn.addEventListener(evn, () => clearTimeout(lpTimer)));
kbBtn.addEventListener("click", () => {
  if (lpFired) { lpFired = false; return; }  // лонг-пресс уже открыл пикер
  if (kbWasUp) kbClose(); else kbOpen();
  haptic();
});
$("#file-in").addEventListener("change", async () => {
  const files = [...($("#file-in").files || [])];
  $("#file-in").value = "";
  for (const f of files) await sendFile(f);
});
/* надёжный путь для iOS: пикер открывается только внутри прямого жеста */
$("#btn-attach").addEventListener("pointerdown", (e) => e.preventDefault());
$("#btn-attach").addEventListener("click", () => {
  haptic();
  try { $("#file-in").click(); } catch (e) {}
});
$("#inp").addEventListener("input", autosize);
const coarsePointer = window.matchMedia && window.matchMedia("(pointer: coarse)").matches;
$("#inp").addEventListener("keydown", (e) => {
  /* на телефоне Enter — перенос строки; отправка кнопкой */
  if (e.key === "Enter" && !e.shiftKey && !coarsePointer) {
    e.preventDefault(); send();
  }
});

/* ---------- свайпы: сессии от левого края, модель от правого ---------- */
const swipe = { x: 0, y: 0, ok: false, axis: null };

document.addEventListener("touchstart", (e) => {
  const t = e.touches[0];
  swipe.x = t.clientX; swipe.y = t.clientY;
  swipe.ok = true; swipe.axis = null;
  /* палец внутри прокручиваемого списка — нативный скролл не трогаем */
  swipe.inList = !!(e.target.closest &&
    e.target.closest("#sess-list, #model-list, .alog-lines, #asks"));
}, { passive: true });

document.addEventListener("touchmove", (e) => {
  if (!swipe.ok) return;
  const t = e.touches[0];
  const dx = t.clientX - swipe.x, dy = t.clientY - swipe.y;
  if (!swipe.axis && (Math.abs(dx) > 12 || Math.abs(dy) > 12)) {
    swipe.axis = Math.abs(dx) > Math.abs(dy) + 6 ? "h" : "v";
  }
  if (swipe.axis === "h") e.preventDefault(); // не скроллим чат в горизонтальном жесте
}, { passive: false });

document.addEventListener("touchend", (e) => {
  if (!swipe.ok) return;
  swipe.ok = false;
  if (swipe.axis !== "h") return;
  const dx = e.changedTouches[0].clientX - swipe.x;
  const fromLeft = swipe.x <= 28;
  const fromRight = swipe.x >= window.innerWidth - 28;
  const drawerOpen = $("#drawer").classList.contains("open");
  const sheetOpen = $("#sheet").classList.contains("open");
  if (!drawerOpen && !sheetOpen && fromLeft && dx > 56) { openDrawer(); haptic(); }
  else if (!drawerOpen && !sheetOpen && fromRight && dx < -56) { openSheet(); haptic(); }
  else if (drawerOpen && dx < -56) closeDrawer();
  else if (sheetOpen && dx > 56) closeSheet();
});

/* возврат из фона: переподключаем живые каналы */
document.addEventListener("visibilitychange", async () => {
  if (document.visibilityState !== "visible") return;
  await refreshBackendConfig();
  if (conn.base !== undefined && conn.base !== apiBase()) wsConnect();
  if (!conn.open) wsConnect();
  loadState(true).catch(() => {});
});
if (tg && tg.BackButton) {
  try { tg.BackButton.onClick(() => { closeDrawer(); closeSheet(); }); } catch (e) {}
}

/* ---------- настройки (веб-версия): адрес сервера, выход ---------- */
function openSet() {
  $("#set-server").value = manualServer() || apiBase();
  $("#setsheet").classList.add("open"); $("#scrim").classList.add("show");
  updatePushUI();
}
function closeSet() {
  $("#setsheet").classList.remove("open");
  if (!$("#drawer").classList.contains("open") &&
      !$("#sheet").classList.contains("open")) {
    $("#scrim").classList.remove("show");
  }
}
if (!isTG()) $("#btn-set").hidden = false;
$("#btn-set").addEventListener("click", openSet);
$("#setsheet-close").addEventListener("click", closeSet);
$("#set-save").addEventListener("click", () => {
  const v = $("#set-server").value.trim().replace(/\/+$/, "");
  try {
    if (v) localStorage.setItem(SERVER_KEY, v);
    else localStorage.removeItem(SERVER_KEY);
  } catch (e) {}
  closeSet(); haptic("ok"); toast("АДРЕС СОХРАНЁН");
  syncSWAuth();
  if (conn.base !== undefined && conn.base !== apiBase()) wsConnect();
});
$("#set-auto").addEventListener("click", () => {
  try { localStorage.removeItem(SERVER_KEY); } catch (e) {}
  closeSet(); haptic("ok"); toast("АВТОАДРЕС");
  syncSWAuth();
  if (conn.base !== undefined && conn.base !== apiBase()) wsConnect();
});
$("#set-logout").addEventListener("click", logout);

/* автоконфиг мог обновиться (туннель сменился) — перечитываем при возврате */
async function refreshBackendConfig() {
  if (isTG()) return;
  try {
    const r = await fetch("web-config.js?_=" + Date.now(), { cache: "no-store" });
    if (r.ok) new Function(await r.text())();
  } catch (e) {}
}

/* настроенный адрес не отвечает, а автоконфиг знает другой — переключаемся */
function maybeAutoHeal() {
  const auto = String(window.DSH_BACKEND || "").trim().replace(/\/+$/, "");
  const manual = manualServer().trim().replace(/\/+$/, "");
  if (auto && manual && auto !== manual) {
    try { localStorage.setItem(SERVER_KEY, auto); } catch (e) {}
    toast("АДРЕС СЕРВЕРА ОБНОВЛЁН");
    return true;
  }
  return false;
}

/* ---------- push-уведомления (iOS 16.4+, установленное на «Домой» PWA) ---------- */
function urlB64ToUint8Array(b64) {
  const pad = "=".repeat((4 - (b64.length % 4)) % 4);
  const raw = atob((b64 + pad).replace(/-/g, "+").replace(/_/g, "/"));
  const arr = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) arr[i] = raw.charCodeAt(i);
  return arr;
}

async function pushStatusText() {
  try {
    if (!("serviceWorker" in navigator) || !("PushManager" in window)) {
      return "нужна установка на «Домой» (iOS 16.4+)";
    }
    const reg = await navigator.serviceWorker.ready;
    const sub = await reg.pushManager.getSubscription();
    return sub ? "включены" : "выключены";
  } catch (e) { return "неизвестно"; }
}

async function updatePushUI() {
  const el = $("#push-state");
  if (el) el.textContent = "СТАТУС: " + (await pushStatusText());
}

$("#push-enable").addEventListener("click", async () => {
  try {
    if (!("PushManager" in window)) { haptic("err"); toast("ПУШИ НЕ ПОДДЕРЖАНЫ", true); return; }
    const perm = await Notification.requestPermission();
    if (perm !== "granted") { haptic("err"); toast("НЕТ РАЗРЕШЕНИЯ", true); return; }
    const reg = await navigator.serviceWorker.ready;
    let sub = await reg.pushManager.getSubscription();
    if (!sub) {
      const { publicKey } = await api("/api/push/key");
      sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlB64ToUint8Array(publicKey),
      });
    }
    await api("/api/push/subscribe",
      { method: "POST", body: JSON.stringify({ subscription: sub.toJSON() }) });
    haptic("ok"); toast("ПУШИ ВКЛЮЧЕНЫ"); updatePushUI();
  } catch (e) { haptic("err"); toast("ОШИБКА: " + e.message, true); }
});

$("#push-off").addEventListener("click", async () => {
  try {
    const reg = await navigator.serviceWorker.ready;
    const sub = await reg.pushManager.getSubscription();
    if (sub) {
      await api("/api/push/unsubscribe",
        { method: "POST", body: JSON.stringify({ endpoint: sub.endpoint }) }).catch(() => {});
      await sub.unsubscribe();
    }
    toast("ПУШИ ВЫКЛЮЧЕНЫ"); updatePushUI();
  } catch (e) { haptic("err"); toast("ОШИБКА: " + e.message, true); }
});

$("#push-test").addEventListener("click", async () => {
  try {
    const r = await api("/api/push/test", { method: "POST", body: "{}" });
    toast(r.sent ? "ОТПРАВЛЕНО: " + r.sent : "НЕТ ПОДПИСОК", !r.sent);
  } catch (e) { haptic("err"); toast("ОШИБКА: " + e.message, true); }
});

if (!isTG()) { const pb = $("#push-block"); if (pb) pb.hidden = false; }

/* --- service worker: адрес + токен устройства (для ответов кнопками из пуша) --- */
const AUTH_CACHE = "pult-auth";
async function syncSWAuth(clear) {
  if (!("serviceWorker" in navigator) || isTG()) return;
  try {
    const cache = await caches.open(AUTH_CACHE);
    if (clear) { await cache.delete("/__auth"); return; }
    await cache.put("/__auth", new Response(JSON.stringify(
      { base: apiBase(), token: deviceToken() || webToken() })));
  } catch (e) {}
}

/* открыть карточку подтверждения: при необходимости переключить чат */
function openAskByEvent(eventId, tries) {
  const a = state.asks.find((x) => x.eventId === eventId);
  if (a) {
    const go = (a.sessionId && a.sessionId !== state.active)
      ? openSession(a.sessionId) : Promise.resolve();
    go.then(() => {
      renderAsks();
      const el = document.getElementById("ask-" + eventId);
      if (el) el.scrollIntoView({ block: "center", behavior: "smooth" });
    });
    return;
  }
  if ((tries || 0) < 10) setTimeout(() => openAskByEvent(eventId, (tries || 0) + 1), 500);
}

if ("serviceWorker" in navigator) {
  navigator.serviceWorker.addEventListener("message", (e) => {
    const m = e.data || {};
    if (m.type === "open-ask" && m.eventId) openAskByEvent(m.eventId);
  });
}

/* ---------- start ---------- */
(async function start() {
  if (!isTG() && !deviceToken() && webToken()) {
    /* легаси-вход по сыром ключу: сверяем хэш локально */
    try { if ((await sha256Hex(webToken())) !== TOKEN_HASH) { logout(); return; } } catch (e) {}
  }
  updateConn(false, "СОЕДИНЕНИЕ…");
  /* хеш #ask=<eventId> — пришли из пуша: открыть нужный чат с карточкой */
  if (location.hash.startsWith("#ask=")) {
    const askId = decodeURIComponent(location.hash.slice(5));
    history.replaceState(null, "", location.pathname);
    openAskByEvent(askId);
  }
  syncSWAuth();
  /* миграция: сырой ключ -> токен устройства (тихо, один раз, повтор при неудаче) */
  if (!isTG() && !deviceToken() && webToken()) {
    (async () => {
      try {
        const r = await fetch(apiBase() + "/api/device/login", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ key: webToken() }),
        });
        if (r.ok) {
          const j = await r.json();
          if (j.deviceToken) {
            try {
              localStorage.setItem(DEVICE_KEY, j.deviceToken);
              localStorage.removeItem(TOKEN_KEY);
            } catch (e) {}
            syncSWAuth();
          }
        }
      } catch (e) {}
    })();
  }
  /* заполняем лоадбар палочками с каскадной задержкой */
  const bar = $("#loadbar");
  if (bar) {
    for (let i = 0; i < 12; i++) {
      const s = document.createElement("i");
      s.style.animationDelay = (i * 0.09) + "s";
      bar.appendChild(s);
    }
  }
  wsConnect();
  try {
    await loadState(false);
    if (state.active) await openSession(state.active);
  } catch (e) {
    updateConn(false, "ОШИБКА: " + e.message);
    toast("НЕТ СВЯЗИ: " + e.message, true);
  }
})();
