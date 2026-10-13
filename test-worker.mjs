// Проверка бота без Telegram и Cloudflare: node test-worker.mjs
import worker, { tgUserFrom, digestText, runDigests } from "./worker.js";
const calls = [];
globalThis.fetch = async (u, o) => { calls.push({ method: u.split("/").pop(), body: JSON.parse(o.body) }); return { json: async () => ({ ok: true }) }; };
const env = { BOT_TOKEN: "123:abc", APP_URL: "https://example.github.io/tabel/", WEBHOOK_SECRET: "s3cret_s3cret_s3cret", AUTHOR_TG: "nikita" };
let pass = 0, fail = 0;
const ok = (n, c, x) => { c ? (pass++, console.log("  ✓ " + n)) : (fail++, console.log("  ✗ " + n + (x ? "  → " + x : ""))); };
const hook = (msg, secret = env.WEBHOOK_SECRET) => worker.fetch(new Request("https://bot.example.workers.dev/hook", { method: "POST", headers: { "X-Telegram-Bot-Api-Secret-Token": secret }, body: JSON.stringify({ message: msg }) }), hookEnv);
let hookEnv = env;
const pm = (text) => ({ chat: { id: 42, type: "private" }, from: { first_name: "Анна" }, text });

calls.length = 0; let r = await hook(pm("/start"));
ok("/start: ответ 200 для Telegram", r.status === 200);
ok("/start: приветствие по имени", calls[0] && calls[0].body.text.startsWith("Привет, Анна!"), calls[0] && calls[0].body.text.slice(0, 40));
const btn = calls[0].body.reply_markup.inline_keyboard[0][0];
ok("/start: кнопка «Открыть Табель» открывает приложение", btn.text === "Открыть Табель" && btn.web_app.url === env.APP_URL);
calls.length = 0; await hook(pm("/start ref_school"));
ok("/start с параметром тоже приветствует", calls[0] && calls[0].body.text.includes("«Табель»"));
calls.length = 0; await hook(pm("/help"));
ok("/help: инструкция и ник автора", calls[0] && calls[0].body.text.includes("Как пользоваться") && calls[0].body.text.includes("@nikita"));
calls.length = 0; await hook(pm("привет, а как добавить ученика?"));
ok("любой текст: подсказка и кнопка", calls[0] && calls[0].body.text.includes("/help") && calls[0].body.reply_markup);
calls.length = 0; await hook({ chat: { id: -1, type: "group" }, text: "/start" });
ok("в группах молчит", calls.length === 0);
calls.length = 0; r = await hook(pm("/start"), "wrong");
ok("чужой запрос без секрета отклоняется", r.status === 403 && calls.length === 0);
calls.length = 0; r = await worker.fetch(new Request("https://bot.example.workers.dev/setup?key=nope"), env);
ok("настройка без ключа запрещена", r.status === 403 && calls.length === 0);
calls.length = 0; r = await worker.fetch(new Request("https://bot.example.workers.dev/setup?key=" + env.WEBHOOK_SECRET), env);
const sw = calls.find(c => c.method === "setWebhook");
ok("настройка: вебхук на /hook с секретом", r.status === 200 && sw && sw.body.url === "https://bot.example.workers.dev/hook" && sw.body.secret_token === env.WEBHOOK_SECRET);
ok("настройка: меню команд /start и /help", calls.some(c => c.method === "setMyCommands" && c.body.commands.length === 2));
r = await worker.fetch(new Request("https://bot.example.workers.dev/setup?key=" + env.WEBHOOK_SECRET), { ...env, APP_URL: "example.com" });
ok("подскажет, если адрес приложения без https", r.status === 500 && (await r.text()).includes("https://"));
r = await worker.fetch(new Request("https://bot.example.workers.dev/setup?key=" + env.WEBHOOK_SECRET), { ...env, APP_URL: "https://github.com/3tringleee/tabel" });
ok("адрес репозитория вместо сайта — понятная подсказка, куда смотреть", r.status === 500 && (await r.text()).includes("Settings → Pages"));
r = await worker.fetch(new Request("https://bot.example.workers.dev/setup?key=" + env.WEBHOOK_SECRET), env);
ok("после настройки показывает, куда ведёт кнопка", (await r.text()).includes(env.APP_URL));

// ---------- ссылки для родителей ----------
const kv = new Map();
const KV = { get: async (k) => kv.get(k) ?? null, put: async (k, v) => { kv.set(k, v); }, delete: async (k) => { kv.delete(k); } };
const envS = { ...env, SHARES: KV };
const ID = "AbCdEfGhIjKlMnOpQrStUv", WK = "write_key_write_key_write_key_1";
const data = { v: 1, name: "Аня", tutor: "Никита Сергеевич", bal: -2400, per: 1200, upd: "11.10 в 16:52",
  months: [{ label: "Октябрь 2026", rows: [{ d: "07.10", wd: "ср", t: "16:00", k: "done", h: "1 ч", sum: 1200, note: "Логарифмы" }, { d: "09.10", wd: "пт", t: "16:00", k: "moved", to: "" }, { d: "05.10", wd: "пн", k: "pay", sum: 6000 }] }],
  next: [{ d: "14.10", wd: "ср", t: "16:00" }] };
const post = (body, wk = WK, e = envS) => worker.fetch(new Request("https://bot.example.workers.dev/share", { method: "POST", headers: { "x-write-key": wk, "content-type": "application/json" }, body: JSON.stringify(body) }), e);
console.log("\nСсылки для родителей"); hookEnv = envS;
r = await post({ id: ID, data });
ok("приложение сохраняет снимок", r.status === 200 && kv.has("s:" + ID));
ok("ключ записи хранится только как хеш", !kv.get("s:" + ID).includes(WK));
r = await post({ id: ID, data: { ...data, bal: 0 } }, "another_key_another_key_another");
ok("чужой ключ не может перезаписать", r.status === 403 && JSON.parse(kv.get("s:" + ID)).data.bal === -2400);
r = await post({ id: ID, data }, WK, env);
ok("без хранилища — понятная ошибка, а не падение", r.status === 501);
r = await worker.fetch(new Request("https://bot.example.workers.dev/share", { method: "OPTIONS" }), envS);
ok("браузер может обращаться из приложения (CORS)", r.status === 204 && r.headers.get("Access-Control-Allow-Origin") === "*");
r = await worker.fetch(new Request("https://bot.example.workers.dev/p/" + ID), envS);
let html = await r.text();
ok("страница для родителя: имя, долг, занятия", r.status === 200 && html.includes("Аня") && html.includes("Долг") && html.includes("2 400 ₽") && html.includes("проведено"));
ok("страница не индексируется поисковиками", r.headers.get("x-robots-tag") === "noindex");
calls.length = 0; await hook(pm("/start p_" + ID));
const ptxt = calls[0] && calls[0].body.text;
ok("родитель открывает ссылку в боте — видит баланс", ptxt && ptxt.includes("Аня") && ptxt.includes("Долг: <b>2 400 ₽</b>"), ptxt && ptxt.slice(0, 80));
ok("перенос без даты понятен родителю", ptxt && ptxt.includes("новая дата уточняется"));
ok("ближайшие занятия и кнопка «Обновить»", ptxt && ptxt.includes("Ближайшие занятия") && calls[0].body.reply_markup.inline_keyboard[0][0].callback_data === "r:" + ID);
ok("родителю не показываем кнопку приложения репетитора", !JSON.stringify(calls[0].body.reply_markup).includes("web_app"));
calls.length = 0;
await worker.fetch(new Request("https://bot.example.workers.dev/hook", { method: "POST", headers: { "X-Telegram-Bot-Api-Secret-Token": env.WEBHOOK_SECRET }, body: JSON.stringify({ callback_query: { id: "q1", data: "r:" + ID, message: { chat: { id: 42 }, message_id: 7 } } }) }), envS);
ok("«Обновить» перерисовывает сообщение", calls.some(c => c.method === "editMessageText" && c.body.message_id === 7) && calls.some(c => c.method === "answerCallbackQuery"));
r = await worker.fetch(new Request("https://bot.example.workers.dev/share?id=" + ID, { method: "DELETE", headers: { "x-write-key": "nope_nope_nope_nope_nope" } }), envS);
ok("отключить ссылку без ключа нельзя", r.status === 403 && kv.has("s:" + ID));
r = await worker.fetch(new Request("https://bot.example.workers.dev/share?id=" + ID, { method: "DELETE", headers: { "x-write-key": WK } }), envS);
ok("репетитор отключает ссылку", r.status === 200 && !kv.has("s:" + ID));
calls.length = 0; await hook(pm("/start p_" + ID));
ok("после отключения родитель видит «ссылка не действует»", calls[0] && calls[0].body.text.includes("больше не действует"));
r = await worker.fetch(new Request("https://bot.example.workers.dev/p/" + ID), envS);
ok("и страница тоже", r.status === 404);
const hookS = (msg) => worker.fetch(new Request("https://bot.example.workers.dev/hook", { method: "POST", headers: { "X-Telegram-Bot-Api-Secret-Token": env.WEBHOOK_SECRET }, body: JSON.stringify({ message: msg }) }), envS);
calls.length = 0; await hookS(pm("/start p_" + "x".repeat(22)));
ok("несуществующая ссылка — без ошибок", calls[0] && calls[0].body.text.includes("больше не действует"));
r = await worker.fetch(new Request("https://bot.example.workers.dev/p/<script>"), envS);
ok("мусор в адресе не ломает воркер", r.status !== 500);

// если Telegram отклонил оформление — родитель всё равно получает сообщение, а в нём видна причина
kv.set("s:" + ID, JSON.stringify({ w: "x", data, at: 1 }));
let first = true; calls.length = 0;
globalThis.fetch = async (u, o) => { const b = JSON.parse(o.body); calls.push({ method: u.split("/").pop(), body: b }); if (first && b.parse_mode) { first = false; return { json: async () => ({ ok: false, description: "Bad Request: can't parse entities" }) }; } return { json: async () => ({ ok: true }) }; };
await hookS(pm("/start p_" + ID));
ok("отклонённое оформление → простой текст с причиной", calls.length === 2 && !calls[1].body.parse_mode && calls[1].body.text.includes("can't parse entities") && calls[1].body.text.includes("Аня"));

// ---------- утренняя сводка ----------
console.log("\nУтренняя сводка");
const hm = async (key, msg) => { const k = await crypto.subtle.importKey("raw", typeof key === "string" ? new TextEncoder().encode(key) : key, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]); return new Uint8Array(await crypto.subtle.sign("HMAC", k, new TextEncoder().encode(msg))); };
async function makeInit(user, token, authDate = Math.floor(Date.now() / 1000)) {
  const p = new URLSearchParams({ auth_date: String(authDate), query_id: "q1", user: JSON.stringify(user) });
  const dcs = [...p.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1)).map(([k, v]) => k + "=" + v).join("\n");
  const h = [...(await hm(await hm("WebAppData", token), dcs))].map((x) => x.toString(16).padStart(2, "0")).join("");
  p.set("hash", h); return p.toString();
}
const me = { id: 777, first_name: "Никита" };
const init = await makeInit(me, env.BOT_TOKEN);
ok("подпись Telegram проверяется", (await tgUserFrom(init, env.BOT_TOKEN))?.id === 777);
ok("поддельная подпись не проходит", (await tgUserFrom(init.replace(/hash=[0-9a-f]{4}/, "hash=0000"), env.BOT_TOKEN)) === null);
ok("подпись чужого бота не проходит", (await tgUserFrom(init, "999:other")) === null);
ok("старая подпись (больше недели) не проходит", (await tgUserFrom(await makeInit(me, env.BOT_TOKEN, 1000), env.BOT_TOKEN)) === null);
KV.list = async ({ prefix }) => ({ keys: [...kv.keys()].filter((k) => k.startsWith(prefix)).map((name) => ({ name })), list_complete: true });
const dig = { today: "2026-10-13", unmarked: 1, debt: 4500, moves: ["Марта"], days: {
  "2026-10-13": [{ t: "16:00", n: "Вера", tp: "Алгебра", done: true }, { t: "18:00", n: "Рома" }],
  "2026-10-14": [{ t: "16:00", n: "Вера", tp: "Геометрия" }, { t: "19:30", n: "Саша" }] } };
const postD = (body) => worker.fetch(new Request("https://bot.example.workers.dev/digest", { method: "POST", body: JSON.stringify(body) }), envS);
r = await postD({ initData: init, data: dig, hour: 8, tz: -180 });
ok("приложение включает сводку", r.status === 200 && kv.has("d:777"));
r = await postD({ initData: init.replace(/hash=[0-9a-f]{4}/, "hash=0000"), data: dig });
ok("без настоящей подписи сводку не включить", r.status === 403);
const t14 = digestText(JSON.parse(kv.get("d:777")), "2026-10-14").text;
ok("утром: занятия на сегодня с темами", t14.includes("Сегодня, ср 14.10, 2 занятия") && t14.includes("• 16:00 Вера · Геометрия") && t14.includes("• 19:30 Саша"), t14.slice(0, 90));
ok("неотмеченные: прежние + вчерашние, которые не отметили", t14.includes("Не отмечено: 2 занятия"));
ok("переносы без даты и долг", t14.includes("Марта") && t14.includes("4 500 ₽"));
calls.length = 0;
globalThis.fetch = async (u, o) => { calls.push({ method: u.split("/").pop(), body: JSON.parse(o.body) }); return { json: async () => ({ ok: true }) }; };
let n = await runDigests(envS, Date.parse("2026-10-14T04:30:00Z"));      // 07:30 МСК — рано
ok("до выбранного часа не пишет", n === 0 && calls.length === 0);
n = await runDigests(envS, Date.parse("2026-10-14T05:10:00Z"));          // 08:10 МСК
ok("в 8 утра по Москве присылает сводку с кнопкой приложения", n === 1 && calls[0].body.chat_id === 777 && calls[0].body.reply_markup.inline_keyboard[0][0].web_app);
n = await runDigests(envS, Date.parse("2026-10-14T05:40:00Z"));
ok("второй раз за день не пишет", n === 0);
kv.set("d:777", JSON.stringify({ ...JSON.parse(kv.get("d:777")), sent: "", data: { today: "2026-10-18", days: {} } }));
calls.length = 0; n = await runDigests(envS, Date.parse("2026-10-18T05:10:00Z"));
ok("пустой день без дел — не беспокоит", n === 0 && calls.length === 0);
r = await worker.fetch(new Request("https://bot.example.workers.dev/digest", { method: "DELETE", body: JSON.stringify({ initData: init }) }), envS);
ok("сводку можно выключить", r.status === 200 && !kv.has("d:777"));

console.log(fail ? `\nПРОВАЛЕНО: ${fail}` : `\nБот: все проверки пройдены (${pass})`);
process.exit(fail ? 1 : 0);
