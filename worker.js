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
  await env.SHARES.put("s:" + o.id, JSON.stringify({ w: h, data: o.data, at: Date.now() }), { expirationTtl: SHARE_TTL });
  return jsonRes({ ok: true });
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

export default {
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
      ];
      return new Response(lines.join("\n"), { headers: { "content-type": "text/plain; charset=utf-8" } });
    }

    // Ссылки для родителей
    if (url.pathname === "/share" && request.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
    if (url.pathname === "/share" && request.method === "POST") return saveShare(request, env);
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
