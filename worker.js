// Табель — бот: отвечает на /start и /help, ничего не хранит.
// Работает на Cloudflare Workers (бесплатно). Настройки задаются в Cloudflare,
// в коде их нет:
//   BOT_TOKEN       — токен бота от @BotFather (тип «Secret»)
//   APP_URL         — адрес приложения на GitHub Pages, https://… (тип «Text»)
//   WEBHOOK_SECRET  — любая строка из латиницы и цифр, 20+ символов (тип «Secret»)
//   AUTHOR_TG       — ваш ник в Telegram без @, необязательно (тип «Text»)
// Ссылки для родителей: хранилище KV с именем привязки SHARES (Storage → KV → Create,
// затем воркер → Settings → Bindings → KV namespace, имя переменной SHARES).
// После сохранения откройте один раз: https://<адрес воркера>/setup?key=<WEBHOOK_SECRET>

const WELCOME = (name) =>
`Привет${name ? ", " + name : ""}! Это «Табель» — учёт занятий и оплат для репетитора.

• Отметили урок — баланс ученика посчитан сам
• Переносы и отмены без путаницы
• В конце месяца — готовый отчёт родителю

Записи хранятся только в вашем Telegram, автор их не видит.
Нажмите кнопку ниже — первого ученика можно добавить за минуту.`;

const HELP = (author) =>
`Как пользоваться:
1. Добавьте ученика: имя, дни, время и цену за час.
2. После урока нажмите «Проведено».
3. Пришли деньги — «Ученики» → «Оплата».
4. В конце месяца — «Отчёт» → текст родителю.

Копия на всякий случай: Настройки → Резервная копия.
Нашли ошибку: Настройки → О приложении → «Скопировать»${author ? " и пришлите @" + author : " и пришлите автору"}.`;

const OTHER = "Всё работает в приложении — откройте его кнопкой ниже.\n/help — короткая инструкция.";

// Частая ошибка: вставить адрес репозитория (github.com/…) вместо адреса сайта (….github.io/…)
function checkAppUrl(u) {
  let host = "";
  try { host = new URL(u).hostname; } catch (e) { return "APP_URL не похож на адрес сайта: " + u; }
  if (host === "github.com" || host === "www.github.com")
    return "APP_URL — это адрес репозитория на github.com, а нужен адрес самого сайта.\n" +
      "Где взять: GitHub → ваш репозиторий → Settings → Pages → строка «Your site is live at …».\n" +
      "Он выглядит так: https://ваш-ник.github.io/название-репозитория/\n" +
      "Это тот же адрес, что стоит в @BotFather в кнопке меню бота.";
  return "";
}

const openButton = (url) => ({ inline_keyboard: [[{ text: "Открыть Табель", web_app: { url } }]] });

/* ---------- ссылки для родителей ----------
   Приложение репетитора присылает сюда снимок: баланс и занятия одного ученика.
   Родитель смотрит его в боте (t.me/<бот>?start=p_<id>) или на странице /p/<id>.
   Перезаписать или удалить снимок можно только с ключом, который знает приложение. */
const SHARE_TTL = 60 * 60 * 24 * 180;           // полгода без обновлений — удаляется сам
const okId = (s) => /^[A-Za-z0-9_-]{16,40}$/.test(s || "");
const CORS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "POST, DELETE, OPTIONS", "Access-Control-Allow-Headers": "content-type, x-write-key", "Access-Control-Max-Age": "86400" };
const jsonRes = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: { "content-type": "application/json; charset=utf-8", ...CORS } });
async function sha(s) { const b = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s)); return [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, "0")).join(""); }
const escH = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const rubS = (n) => Math.round(+n || 0).toLocaleString("ru-RU").replace(/\u202f|\u00a0/g, " ") + " ₽";
function pluralRu(n, a, b, c) { n = Math.abs(n) % 100; const m = n % 10; return n > 10 && n < 20 ? c : m > 1 && m < 5 ? b : m === 1 ? a : c; }

async function readShare(env, id) {
  if (!env.SHARES || !okId(id)) return null;
  const raw = await env.SHARES.get("s:" + id);
  if (!raw) return null;
  try { return JSON.parse(raw); } catch (e) { return null; }
}
async function saveShare(request, env) {
  if (!env.SHARES) return jsonRes({ ok: false, error: "no_kv" }, 501);
  const wk = request.headers.get("x-write-key") || "";
  const body = await request.text();
  if (body.length > 64000) return jsonRes({ ok: false, error: "too_big" }, 413);
  let o; try { o = JSON.parse(body); } catch (e) { return jsonRes({ ok: false, error: "bad_json" }, 400); }
  if (!okId(o.id) || wk.length < 20 || !o.data || typeof o.data !== "object") return jsonRes({ ok: false, error: "bad_request" }, 400);
  const h = await sha(wk), old = await readShare(env, o.id);
  if (old && old.w !== h) return jsonRes({ ok: false, error: "forbidden" }, 403);
  await env.SHARES.put("s:" + o.id, JSON.stringify({ ...(old || {}), w: h, data: o.data, at: Date.now() }), { expirationTtl: SHARE_TTL });
  return jsonRes({ ok: true, subs: old && old.subs ? old.subs.length : 0, rem: old && old.rem || 0 });
}
const putShare = (env, id, rec) => env.SHARES.put("s:" + id, JSON.stringify(rec), { expirationTtl: SHARE_TTL });

/* ---------- напоминание родителю об оплате ----------
   Родитель, открывший ссылку в боте, подписан на напоминания этого ученика (subs).
   Напоминает репетитор кнопкой в приложении или бот сам — по понедельникам, если есть долг. */
const REMIND_GAP = 12 * 3600 * 1000;           // ручное напоминание — не чаще раза в 12 часов
function remindText(d) {
  const L = [`Добрый день! Напоминание об оплате занятий — ${escH(d.name)}.`, "", `Долг за проведённые занятия: <b>${rubS(-d.bal)}</b>`];
  if (d.how) L.push(`Как оплатить: ${escH(d.how)}`);
  if (d.tutor) L.push("", `Преподаватель: ${escH(d.tutor)}`);
  return L.join("\n");
}
const remindKeyboard = (id) => ({ inline_keyboard: [[{ text: "Подробнее: занятия и оплаты", callback_data: "r:" + id }], [{ text: "Не присылать напоминания", callback_data: "u:" + id }]] });
async function sendReminder(env, id, rec, now = Date.now()) {
  let sent = 0; const keep = [];
  for (const chat of rec.subs || []) {
    const r = await sendShare(env, "sendMessage", { chat_id: chat, parse_mode: "HTML", text: remindText(rec.data), reply_markup: remindKeyboard(id) });
    if (r && r.ok) { sent++; keep.push(chat); } else if (!(r && r.error_code === 403)) keep.push(chat);   // заблокировал бота — убираем
  }
  rec.subs = keep; rec.rem = now;
  await putShare(env, id, rec);
  return sent;
}
async function remindNow(request, env) {
  if (!env.SHARES) return jsonRes({ ok: false, error: "no_kv" }, 501);
  let o; try { o = JSON.parse(await request.text()); } catch (e) { return jsonRes({ ok: false, error: "bad_json" }, 400); }
  const rec = okId(o.id) ? await readShare(env, o.id) : null;
  if (!rec) return jsonRes({ ok: false, error: "not_found" }, 404);
  if (rec.w !== await sha(request.headers.get("x-write-key") || "")) return jsonRes({ ok: false, error: "forbidden" }, 403);
  if (!(rec.data && rec.data.bal < 0)) return jsonRes({ ok: false, error: "no_debt" }, 409);
  if (!rec.subs || !rec.subs.length) return jsonRes({ ok: false, error: "no_subs" }, 409);
  if (rec.rem && Date.now() - rec.rem < REMIND_GAP) return jsonRes({ ok: false, error: "too_soon", rem: rec.rem }, 429);
  const sent = await sendReminder(env, o.id, rec);
  return jsonRes({ ok: sent > 0, sent, error: sent ? undefined : "not_delivered", rem: rec.rem }, sent ? 200 : 502);
}
/* Автонапоминания: по понедельникам в 10:00 (время репетитора), если долг есть и с прошлого напоминания прошло 5+ дней */
async function runReminders(env, now = Date.now()) {
  if (!env.SHARES || !env.SHARES.list) return 0;
  let cursor, n = 0;
  do {
    const page = await env.SHARES.list({ prefix: "s:", cursor });
    for (const k of page.keys) {
      const raw = await env.SHARES.get(k.name); if (!raw) continue;
      let rec; try { rec = JSON.parse(raw); } catch (e) { continue; }
      const d = rec.data || {};
      if (d.auto !== "week" || !(d.bal < 0) || !(rec.subs && rec.subs.length)) continue;
      const ln = localNow(d.tz ?? -180, now);
      if (ln.getUTCDay() !== 1 || ln.getUTCHours() !== 10) continue;
      if (rec.rem && now - rec.rem < 5 * 24 * 3600 * 1000) continue;
      n += await sendReminder(env, k.name.slice(2), rec, now);
    }
    cursor = page.list_complete ? null : page.cursor;
  } while (cursor);
  return n;
}
async function deleteShare(request, env, id) {
  if (!env.SHARES) return jsonRes({ ok: false, error: "no_kv" }, 501);
  const old = await readShare(env, id);
  if (!old) return jsonRes({ ok: true });
  if (old.w !== await sha(request.headers.get("x-write-key") || "")) return jsonRes({ ok: false, error: "forbidden" }, 403);
  await env.SHARES.delete("s:" + id);
  return jsonRes({ ok: true });
}

const KIND = {
  done: ["✅", (r) => `проведено · ${r.h}${r.sum ? " · " + rubS(r.sum) : ""}`],
  trial: ["✅", (r) => `пробное занятие · бесплатно`],
  cpaid: ["⏸", (r) => `отмена с оплатой${r.sum ? " · " + rubS(r.sum) : ""}`],
  cfree: ["❌", () => "отмена, без оплаты"],
  cpend: ["❌", () => "отмена"],
  moved: ["↪️", (r) => r.to ? `перенос на ${r.to}` : "перенос, новая дата уточняется"],
  skip: ["🏖", () => "не было (каникулы)"],
  pay: ["💳", (r) => `оплата +${rubS(r.sum)}`],
};
function balanceLines(d) {
  const L = [];
  /* Родитель видит то же, что репетитор: долг за уже проведённые занятия или аванс. План на месяц вперёд не показываем. */
  if (d.bal < 0) L.push(`Долг: <b>${rubS(-d.bal)}</b>`);
  else if (d.bal > 0) L.push(`Оплачено вперёд: <b>${rubS(d.bal)}</b>` + (d.per > 0 && d.bal >= d.per ? ` — это примерно ${Math.floor(d.bal / d.per)} ${pluralRu(Math.floor(d.bal / d.per), "занятие", "занятия", "занятий")}` : ""));
  else L.push("Долга нет, всё оплачено ✅");
  return L;
}
function shareText(d, maxRows) {
  const L = [`<b>${escH(d.name)}</b>`, ...(d.tutor ? ["Преподаватель: " + escH(d.tutor)] : []), ""];
  L.push(...balanceLines(d));
  let rows = 0;
  for (const m of d.months || []) {
    if (!m.rows || !m.rows.length || rows >= maxRows) continue;
    L.push("", `<b>${escH(m.label)}</b>`);
    for (const r of m.rows) {
      if (rows++ >= maxRows) break;
      const k = KIND[r.k] || ["•", () => ""];
      L.push(`${k[0]} ${escH(r.d)} ${escH(r.wd || "")}${r.t ? ", " + escH(r.t) : ""} — ${escH(k[1](r))}${r.note ? "\n      <i>" + escH(r.note) + "</i>" : ""}`);
    }
  }
  if (d.next && d.next.length) L.push("", "<b>Ближайшие занятия</b>", ...d.next.map((n) => `• ${escH(n.wd)} ${escH(n.d)}${n.t ? ", " + escH(n.t) : ""}`));
  L.push("", `<i>Обновлено ${escH(d.upd || "")}</i>`);
  return L.join("\n");
}
const shareKeyboard = (id, origin) => ({ inline_keyboard: [[{ text: "🔄 Обновить", callback_data: "r:" + id }], [{ text: "Подробнее в браузере", url: `${origin}/p/${id}` }]] });
const GONE = "Эта ссылка больше не действует. Попросите у преподавателя новую.";
const plainText = (t) => t.replace(/<[^>]+>/g, "").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&amp;/g, "&");
/* Отправить сообщение родителю. Если Telegram отклонил оформление или кнопки — отправить простым текстом
   и дописать причину, чтобы её было видно прямо в чате. */
async function sendShare(env, method, body) {
  const r = await tg(env, method, body);
  if (r && r.ok) return r;
  const why = (r && r.description) || "нет ответа";
  const plain = { ...body, text: plainText(body.text) + "\n\n(техническая заметка: " + why + ")" };
  delete plain.parse_mode; delete plain.reply_markup;
  return tg(env, method, plain);
}

function sharePage(d) {
  const blocks = (d.months || []).filter((m) => m.rows && m.rows.length).map((m) => `<h2>${escH(m.label)}</h2><ul>${m.rows.map((r) => {
    const k = KIND[r.k] || ["•", () => ""];
    return `<li class="${escH(r.k)}"><span class="ic">${k[0]}</span><div><b>${escH(r.d)} ${escH(r.wd || "")}${r.t ? ", " + escH(r.t) : ""}</b><span>${escH(k[1](r))}</span>${r.note ? `<em>${escH(r.note)}</em>` : ""}</div></li>`; }).join("")}</ul>`).join("");
  const next = d.next && d.next.length ? `<h2>Ближайшие занятия</h2><ul>${d.next.map((n) => `<li><span class="ic">🗓</span><div><b>${escH(n.wd)} ${escH(n.d)}${n.t ? ", " + escH(n.t) : ""}</b></div></li>`).join("")}</ul>` : "";
  const neg = d.bal < 0;
  return `<!doctype html><html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escH(d.name)} — занятия и оплата</title><meta name="robots" content="noindex">
<style>:root{--bg:#F5F4F2;--paper:#fff;--ink:#24202B;--muted:#7A7486;--line:#E7E2DC;--red:#A8405A;--green:#3C7A63}
@media (prefers-color-scheme:dark){:root{--bg:#17151C;--paper:#201D28;--ink:#EDE9F2;--muted:#9E97AC;--line:#332E3E;--red:#E8909F;--green:#88C9AE}}
body{margin:0;background:var(--bg);color:var(--ink);font:15px/1.45 -apple-system,system-ui,"Segoe UI",Roboto,sans-serif}
main{max-width:560px;margin:0 auto;padding:20px 16px 40px}.card{background:var(--paper);border:1px solid var(--line);border-radius:16px;padding:16px 18px;margin-bottom:12px}
h1{font-size:22px;margin:0}.sub{color:var(--muted);margin-top:2px}.bal{font-size:16px;margin-top:12px}.bal b{font-size:22px;color:${neg ? "var(--red)" : "var(--green)"}}
h2{font-size:15px;margin:4px 0 8px}ul{list-style:none;margin:0;padding:0}li{display:flex;gap:10px;padding:8px 0;border-top:1px solid var(--line)}li:first-child{border-top:0}
li .ic{width:22px;flex:none;text-align:center}li b{display:block;font-weight:600}li span{color:var(--muted)}li em{display:block;font-style:normal;font-size:13.5px;margin-top:2px}
.upd{color:var(--muted);font-size:13px;text-align:center}</style></head><body><main>
<div class="card"><h1>${escH(d.name)}</h1>${d.tutor ? `<div class="sub">Преподаватель: ${escH(d.tutor)}</div>` : ""}<div class="bal">${balanceLines(d).join("<br>")}</div></div>
${blocks ? `<div class="card">${blocks}</div>` : ""}${next ? `<div class="card">${next}</div>` : ""}
<div class="upd">Обновлено ${escH(d.upd || "")} · «Табель»</div></main></body></html>`;
}

async function tg(env, method, body) {
  const r = await fetch(`https://api.telegram.org/bot${env.BOT_TOKEN}/${method}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  return r.json();
}

async function onUpdate(update, env, origin) {
  const cq = update.callback_query;
  if (cq && /^u:/.test(cq.data || "")) {
    const id = cq.data.slice(2), sh = await readShare(env, id), chat = cq.message && cq.message.chat.id;
    if (sh && sh.subs) { sh.subs = sh.subs.filter((c) => c !== chat); await putShare(env, id, sh); }
    await tg(env, "answerCallbackQuery", { callback_query_id: cq.id, text: "Напоминания отключены" });
    if (cq.message) await tg(env, "sendMessage", { chat_id: chat, text: "Напоминания об оплате больше не придут. Баланс и занятия можно посмотреть по прежней ссылке в любой момент." });
    return;
  }
  if (cq && /^r:/.test(cq.data || "")) {
    const id = cq.data.slice(2), sh = await readShare(env, id);
    await tg(env, "answerCallbackQuery", { callback_query_id: cq.id, text: sh ? "Обновлено" : "Ссылка больше не действует" });
    if (cq.message) await sendShare(env, "editMessageText", { chat_id: cq.message.chat.id, message_id: cq.message.message_id, parse_mode: "HTML",
      text: sh ? shareText(sh.data, 40) : GONE, reply_markup: sh ? shareKeyboard(id, origin) : undefined, disable_web_page_preview: true });
    return;
  }
  const msg = update.message;
  if (!msg || !msg.chat || msg.chat.type !== "private") return;   // только личные чаты
  const text = (msg.text || "").trim();
  const chat_id = msg.chat.id;
  const markup = openButton(env.APP_URL);
  const pm = text.match(/^\/start\s+p_([A-Za-z0-9_-]{16,40})$/);
  if (pm) {
    const sh = await readShare(env, pm[1]);
    if (!sh) return tg(env, "sendMessage", { chat_id, text: GONE + (env.SHARES ? "" : "\n\n(техническая заметка: у бота не подключено хранилище SHARES)") });
    const subs = sh.subs || [];
    if (!subs.includes(chat_id) && subs.length < 5) { sh.subs = subs.concat([chat_id]); await putShare(env, pm[1], sh); }
    return sendShare(env, "sendMessage", { chat_id, parse_mode: "HTML", text: shareText(sh.data, 40), reply_markup: shareKeyboard(pm[1], origin), disable_web_page_preview: true });
  }
  if (/^\/start\b/.test(text)) {
    return tg(env, "sendMessage", { chat_id, text: WELCOME(msg.from && msg.from.first_name), reply_markup: markup });
  }
  if (/^\/help\b/.test(text)) {
    return tg(env, "sendMessage", { chat_id, text: HELP(env.AUTHOR_TG), reply_markup: markup });
  }
  return tg(env, "sendMessage", { chat_id, text: OTHER, reply_markup: markup });
}

/* ---------- утренняя сводка репетитору ----------
   Приложение (открытое в Telegram) присылает план на ближайшую неделю. Кто прислал — проверяем
   по подписи Telegram (initData), поэтому чужой сводку не включит и спам не отправит.
   Раз в час (Cron Trigger «0 * * * *») бот смотрит, у кого сейчас наступил выбранный час, и пишет. */
const DIGEST_TTL = 60 * 60 * 24 * 30;          // приложение не открывали месяц — сводка сама выключается
async function hmac(key, msg) {
  const k = await crypto.subtle.importKey("raw", typeof key === "string" ? new TextEncoder().encode(key) : key, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return new Uint8Array(await crypto.subtle.sign("HMAC", k, new TextEncoder().encode(msg)));
}
const hex = (b) => [...b].map((x) => x.toString(16).padStart(2, "0")).join("");
/* Проверка initData по документации Telegram Mini Apps. Возвращает пользователя или null. */
async function tgUserFrom(initData, botToken, maxAgeSec = 7 * 24 * 3600) {
  if (!initData || !botToken) return null;
  const p = new URLSearchParams(initData), hash = p.get("hash");
  if (!hash) return null;
  p.delete("hash");
  const dcs = [...p.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1)).map(([k, v]) => k + "=" + v).join("\n");
  const secret = await hmac("WebAppData", botToken);
  if (hex(await hmac(secret, dcs)) !== hash) return null;
  const age = Date.now() / 1000 - (+p.get("auth_date") || 0);
  if (age > maxAgeSec) return null;
  try { return JSON.parse(p.get("user") || "null"); } catch (e) { return null; }
}
async function saveDigest(request, env) {
  if (!env.SHARES) return jsonRes({ ok: false, error: "no_kv" }, 501);
  const body = await request.text();
  if (body.length > 64000) return jsonRes({ ok: false, error: "too_big" }, 413);
  let o; try { o = JSON.parse(body); } catch (e) { return jsonRes({ ok: false, error: "bad_json" }, 400); }
  const u = await tgUserFrom(o.initData, env.BOT_TOKEN);
  if (!u || !u.id) return jsonRes({ ok: false, error: "bad_auth" }, 403);
  const key = "d:" + u.id;
  if (request.method === "DELETE" || o.off) { await env.SHARES.delete(key); return jsonRes({ ok: true, off: true }); }
  if (!o.data || typeof o.data !== "object") return jsonRes({ ok: false, error: "bad_request" }, 400);
  const old = await env.SHARES.get(key);
  let sent = ""; try { sent = old ? JSON.parse(old).sent || "" : ""; } catch (e) {}
  const hour = Math.min(23, Math.max(0, Math.round(+o.hour || 8)));
  const tz = Math.max(-840, Math.min(840, Math.round(+o.tz || -180)));
  await env.SHARES.put(key, JSON.stringify({ chat: u.id, hour, tz, data: o.data, sent, at: Date.now() }), { expirationTtl: DIGEST_TTL });
  return jsonRes({ ok: true });
}
const localNow = (tz, now = Date.now()) => new Date(now - tz * 60000);   // tz — как getTimezoneOffset() (МСК = −180)
const isoDay = (d) => d.toISOString().slice(0, 10);
const WD_RU = ["вс", "пн", "вт", "ср", "чт", "пт", "сб"];
function digestText(rec, today) {
  const d = rec.data || {}, days = d.days || {};
  const todays = (days[today] || []).filter((x) => !x.done);
  // занятия, которые прошли с момента последнего открытия приложения и ещё не отмечены
  let unmarked = +d.unmarked || 0;
  for (const k of Object.keys(days)) if (k >= (d.today || today) && k < today) unmarked += days[k].filter((x) => !x.done).length;
  const dt = new Date(today + "T12:00:00Z");
  const head = `${WD_RU[dt.getUTCDay()]} ${today.slice(8)}.${today.slice(5, 7)}`;
  const L = [];
  if (todays.length) {
    L.push(`Доброе утро! Сегодня, ${head}, ${todays.length} ${pluralRu(todays.length, "занятие", "занятия", "занятий")}:`);
    todays.forEach((x) => L.push(`• ${x.t ? x.t + " " : ""}${x.n}${x.tp ? " · " + x.tp : ""}`));
  } else L.push(`Доброе утро! Сегодня, ${head}, занятий по расписанию нет.`);
  const extra = [];
  if (unmarked > 0) extra.push(`⚠️ Не отмечено: ${unmarked} ${pluralRu(unmarked, "занятие", "занятия", "занятий")}`);
  if (d.moves && d.moves.length) extra.push(`↪️ Переносы без новой даты: ${d.moves.join(", ")}`);
  if (d.debt > 0) extra.push(`💰 Вам должны: ${rubS(d.debt)}`);
  if (extra.length) L.push("", ...extra);
  return { text: L.join("\n"), worth: todays.length > 0 || unmarked > 0 || (d.moves && d.moves.length > 0) };
}
async function runDigests(env, now = Date.now()) {
  if (!env.SHARES || !env.SHARES.list) return 0;
  let cursor, sentN = 0;
  do {
    const page = await env.SHARES.list({ prefix: "d:", cursor });
    for (const k of page.keys) {
      const raw = await env.SHARES.get(k.name); if (!raw) continue;
      let rec; try { rec = JSON.parse(raw); } catch (e) { continue; }
      const ln = localNow(rec.tz, now), today = isoDay(ln);
      if (ln.getUTCHours() !== rec.hour || rec.sent === today) continue;
      const { text, worth } = digestText(rec, today);
      rec.sent = today;
      if (worth) {
        const r = await tg(env, "sendMessage", { chat_id: rec.chat, text, reply_markup: env.APP_URL ? openButton(env.APP_URL) : undefined });
        if (r && r.ok) sentN++;
        else if (r && r.error_code === 403) { await env.SHARES.delete(k.name); continue; }   // бот заблокирован — больше не пишем
      }
      await env.SHARES.put(k.name, JSON.stringify(rec), { expirationTtl: DIGEST_TTL });
    }
    cursor = page.list_complete ? null : page.cursor;
  } while (cursor);
  return sentN;
}

/* ---------- напоминание о занятии ----------
   Тем же подписчикам (родитель или сам ученик, открывшие ссылку) бот напоминает о занятии:
   накануне в 19:00 или утром в день занятия в 9:00 — время репетитора. */
const WD_NOM = ["воскресенье", "понедельник", "вторник", "среда", "четверг", "пятница", "суббота"];
function lessonText(d, lessons, when) {
  const dt = new Date(lessons[0].date + "T12:00:00Z"), dm = lessons[0].date.slice(8) + "." + lessons[0].date.slice(5, 7);
  const day = `${when === "eve" ? "Завтра" : "Сегодня"}, ${WD_NOM[dt.getUTCDay()]}, ${dm}`;
  const what = lessons.map((x) => (x.t ? "в " + x.t : "") + (x.tp ? " · " + escH(x.tp) : "")).filter(Boolean).join(", ");
  const L = [`Напоминание о занятии — ${escH(d.name)}.`, "", `<b>${day}${what ? ", " + what : ""}</b>`, "", "Если планы изменились, пожалуйста, предупредите преподавателя заранее."];
  if (d.tutor) L.push(`Преподаватель: ${escH(d.tutor)}`);
  return L.join("\n");
}
async function runLessonReminders(env, now = Date.now()) {
  if (!env.SHARES || !env.SHARES.list) return 0;
  let cursor, n = 0;
  do {
    const page = await env.SHARES.list({ prefix: "s:", cursor });
    for (const k of page.keys) {
      const raw = await env.SHARES.get(k.name); if (!raw) continue;
      let rec; try { rec = JSON.parse(raw); } catch (e) { continue; }
      const d = rec.data || {};
      if (!(d.lr === "eve" || d.lr === "morn") || !(rec.subs && rec.subs.length) || !Array.isArray(d.up)) continue;
      const ln = localNow(d.tz ?? -180, now);
      if (ln.getUTCHours() !== (d.lr === "eve" ? 19 : 9)) continue;
      const target = isoDay(d.lr === "eve" ? new Date(ln.getTime() + 864e5) : ln);
      if (rec.lsent === target) continue;
      const lessons = d.up.filter((x) => x.date === target);
      if (!lessons.length) continue;
      const id = k.name.slice(2), keep = [];
      for (const chat of rec.subs) {
        const r = await sendShare(env, "sendMessage", { chat_id: chat, parse_mode: "HTML", text: lessonText(d, lessons, d.lr), reply_markup: remindKeyboard(id) });
        if (r && r.ok) { n++; keep.push(chat); } else if (!(r && r.error_code === 403)) keep.push(chat);
      }
      rec.subs = keep; rec.lsent = target;
      await putShare(env, id, rec);
    }
    cursor = page.list_complete ? null : page.cursor;
  } while (cursor);
  return n;
}

/* Подробности для /status: когда последний раз срабатывал запуск по часам и что с каждой сводкой */
const msk = (t) => new Date(t).toLocaleString("ru-RU", { timeZone: "Europe/Moscow", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
async function digestStatusLines(env) {
  if (!env.SHARES || !env.SHARES.list) return [];
  const L = [];
  let cron = null; try { cron = JSON.parse(await env.SHARES.get("meta:cron") || "null"); } catch (e) {}
  L.push(cron ? "Запуск по расписанию: последний раз " + msk(cron.at) + " МСК ✅" : "Запуск по расписанию: ещё ни разу ❌ — включите Cron Trigger «0 * * * *» (Settings → Trigger Events)");
  const keys = (await env.SHARES.list({ prefix: "d:" })).keys;
  L.push("Утренних сводок включено: " + keys.length + (keys.length ? "" : " ❌ — включите в Табеле: аватар → «Утренняя сводка» (приложение должно быть открыто в Telegram)"));
  for (const k of keys.slice(0, 5)) {
    let r = null; try { r = JSON.parse(await env.SHARES.get(k.name)); } catch (e) {}
    if (r) L.push(`  • в ${r.hour}:00 (сдвиг ${-r.tz / 60} ч от UTC) · план от ${(r.data && r.data.today) || "?"} · последняя отправка: ${r.sent || "ещё не было"}`);
  }
  return L;
}
/* Отправить сводку прямо сейчас, не дожидаясь утра: /test-digest?key=<WEBHOOK_SECRET> */
async function testDigests(env) {
  const keys = (await env.SHARES.list({ prefix: "d:" })).keys; let n = 0;
  for (const k of keys) {
    let rec; try { rec = JSON.parse(await env.SHARES.get(k.name)); } catch (e) { continue; }
    const { text } = digestText(rec, isoDay(localNow(rec.tz)));
    const r = await tg(env, "sendMessage", { chat_id: rec.chat, text: "Проверка сводки:\n\n" + text, reply_markup: env.APP_URL ? openButton(env.APP_URL) : undefined });
    if (r && r.ok) n++;
  }
  return n;
}
export { tgUserFrom, digestText, runDigests, runReminders, remindText, runLessonReminders, lessonText };
export default {
  async scheduled(event, env, ctx) {
    const t = event.scheduledTime || Date.now();
    ctx.waitUntil((async () => {
      const [dn, rn] = await Promise.all([runDigests(env, t), runReminders(env, t)]);
      const ln = await runLessonReminders(env, t);
      if (env.SHARES) await env.SHARES.put("meta:cron", JSON.stringify({ at: t, digests: dn, reminders: rn, lessons: ln }));   // для страницы /status
    })());
  },
  async fetch(request, env) {
    const url = new URL(request.url);

    // Разовая настройка: подключить бота к этому адресу и задать меню команд
    if (request.method === "GET" && url.pathname === "/setup") {
      if (!env.WEBHOOK_SECRET || url.searchParams.get("key") !== env.WEBHOOK_SECRET) return new Response("Нет доступа", { status: 403 });
      const txt = { headers: { "content-type": "text/plain; charset=utf-8" } };
      if (!env.BOT_TOKEN || !/^https:\/\//.test(env.APP_URL || "")) return new Response("Не заданы BOT_TOKEN или APP_URL (адрес должен начинаться с https://)", { status: 500, ...txt });
      const appProblem = checkAppUrl(env.APP_URL);
      if (appProblem) return new Response(appProblem, { status: 500, ...txt });
      const hook = await tg(env, "setWebhook", { url: `${url.origin}/hook`, secret_token: env.WEBHOOK_SECRET, allowed_updates: ["message", "callback_query"], drop_pending_updates: true });
      const cmds = await tg(env, "setMyCommands", { commands: [
        { command: "start", description: "Открыть Табель" },
        { command: "help", description: "Как пользоваться" },
      ] });
      const ok = hook.ok && cmds.ok;
      const dns = !hook.ok && /resolve host|name resolution/i.test(hook.description || "");
      return new Response(ok ? "Готово: бот подключён. Напишите ему /start.\nКнопка «Открыть Табель» ведёт на: " + env.APP_URL
        : dns ? "Telegram на минуту не смог найти адрес бота — это сбой на стороне Telegram, а не у вас.\nОбновите эту страницу через 2–3 минуты. Прежняя настройка бота при этом не сбилась.\n\n(" + hook.description + ")"
        : "Ошибка: " + JSON.stringify({ hook, cmds }),
        { status: ok ? 200 : 500, headers: { "content-type": "text/plain; charset=utf-8" } });
    }

    // Проверка связи Telegram → бот: /status?key=<WEBHOOK_SECRET>
    if (request.method === "GET" && url.pathname === "/status") {
      if (!env.WEBHOOK_SECRET || url.searchParams.get("key") !== env.WEBHOOK_SECRET) return new Response("Нет доступа", { status: 403 });
      const info = (await tg(env, "getWebhookInfo", {})).result || {};
      const when = info.last_error_date ? new Date(info.last_error_date * 1000).toLocaleString("ru-RU", { timeZone: "Europe/Moscow" }) : "";
      const lines = [
        "Адрес вебхука: " + (info.url || "НЕ ЗАДАН — откройте /setup?key=…"),
        "Ждут доставки сообщений: " + (info.pending_update_count || 0),
        info.last_error_message ? "Последняя ошибка (" + when + " МСК): " + info.last_error_message : "Ошибок доставки нет ✅",
        "Хранилище ссылок SHARES: " + (env.SHARES ? "подключено ✅" : "не подключено"),
        ...(await digestStatusLines(env)),
      ];
      return new Response(lines.join("\n"), { headers: { "content-type": "text/plain; charset=utf-8" } });
    }

    // Утренняя сводка
    if (request.method === "GET" && url.pathname === "/test-digest") {
      if (!env.WEBHOOK_SECRET || url.searchParams.get("key") !== env.WEBHOOK_SECRET) return new Response("Нет доступа", { status: 403 });
      if (!env.SHARES || !env.SHARES.list) return new Response("Не подключено хранилище SHARES", { status: 500, headers: { "content-type": "text/plain; charset=utf-8" } });
      const n = await testDigests(env);
      return new Response(n ? `Отправлено сводок: ${n}. Проверьте чат с ботом.` : "Отправлять некому: в Табеле не включена утренняя сводка (аватар → «Утренняя сводка»).", { headers: { "content-type": "text/plain; charset=utf-8" } });
    }
    if (url.pathname === "/digest" && request.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
    if (url.pathname === "/digest" && (request.method === "POST" || request.method === "DELETE")) return saveDigest(request, env);

    // Ссылки для родителей
    if (url.pathname === "/share" && request.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
    if (url.pathname === "/share" && request.method === "POST") return saveShare(request, env);
    if (url.pathname === "/remind" && request.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
    if (url.pathname === "/remind" && request.method === "POST") return remindNow(request, env);
    if (url.pathname === "/share" && request.method === "DELETE") return deleteShare(request, env, url.searchParams.get("id"));
    const pp = url.pathname.match(/^\/p\/([A-Za-z0-9_-]{16,40})$/);
    if (pp && request.method === "GET") {
      const sh = await readShare(env, pp[1]);
      const html = sh ? sharePage(sh.data) : `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Ссылка не действует</title><body style="font:16px system-ui;padding:40px 20px;text-align:center">${GONE}</body>`;
      return new Response(html, { status: sh ? 200 : 404, headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store", "x-robots-tag": "noindex" } });
    }

    // Сообщения от Telegram
    if (request.method === "POST" && url.pathname === "/hook") {
      if (request.headers.get("X-Telegram-Bot-Api-Secret-Token") !== env.WEBHOOK_SECRET) return new Response("forbidden", { status: 403 });
      let upd = null;
      try { upd = await request.json(); await onUpdate(upd, env, url.origin); }
      catch (e) {
        /* не роняем вебхук (Telegram будет повторять), но пишем причину в чат — иначе ошибку не найти */
        const chat = upd && ((upd.message && upd.message.chat) || (upd.callback_query && upd.callback_query.message && upd.callback_query.message.chat));
        if (chat && chat.type === "private") { try { await tg(env, "sendMessage", { chat_id: chat.id, text: "Что-то пошло не так. Перешлите это сообщение автору «Табеля».\n\n(техническая заметка: " + String(e && e.message || e).slice(0, 300) + ")" }); } catch (_) {} }
      }
      return new Response("ok");
    }

    return new Response("Табель-бот работает.", { headers: { "content-type": "text/plain; charset=utf-8" } });
  },
};
