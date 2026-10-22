// Проверка бота без Telegram и Cloudflare: node test-worker.mjs
import worker, { balanceLines, savePing, usageLines, scoreLines, shareText, sharePage, tgUserFrom, digestText, runDigests, runReminders, runLessonReminders } from "./worker.js";
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
ok("непробитые чеки в сводке", digestText({ data: { ...dig, receipts: 2 } }, "2026-10-14").text.includes("Не пробиты чеки: 2"));
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


// ---------- напоминание родителю об оплате ----------
console.log("\nНапоминание родителю об оплате");
const RID = "RemindRemindRemind_123", RWK = "remind_write_key_remind_write";
globalThis.fetch = async (u, o) => { calls.push({ method: u.split("/").pop(), body: JSON.parse(o.body) }); return { json: async () => ({ ok: true }) }; };
await post({ id: RID, data: { ...data, bal: -3000, how: "перевод по номеру +7 900 000-00-00 (Т-Банк)", auto: "", tz: -180 } }, RWK);
const remind = (wk = RWK) => worker.fetch(new Request("https://bot.example.workers.dev/remind", { method: "POST", headers: { "x-write-key": wk }, body: JSON.stringify({ id: RID }) }), envS);
r = await remind(); let j = await r.json();
ok("пока родитель не открыл ссылку — понятная ошибка", r.status === 409 && j.error === "no_subs");
calls.length = 0; await hookS({ chat: { id: 501, type: "private" }, from: { first_name: "Ирина" }, text: "/start p_" + RID });
ok("родитель открыл ссылку — подписан на напоминания", JSON.parse(kv.get("s:" + RID)).subs.includes(501));
r = await post({ id: RID, data: { ...data, bal: -3000, how: "перевод по номеру +7 900 000-00-00 (Т-Банк)", auto: "", tz: -180 } }, RWK); j = await r.json();
ok("обновление снимка не теряет подписчика и сообщает о нём приложению", j.subs === 1 && JSON.parse(kv.get("s:" + RID)).subs.length === 1);
r = await remind("wrong_wrong_wrong_wrong_wrong"); ok("чужой ключ не может напомнить", r.status === 403);
calls.length = 0; r = await remind(); j = await r.json();
const rm = calls.find((c) => c.method === "sendMessage");
ok("напоминание ушло родителю: сумма и как оплатить", r.status === 200 && j.sent === 1 && rm.body.chat_id === 501 && rm.body.text.includes("3 000 ₽") && rm.body.text.includes("Т-Банк"), rm && rm.body.text.slice(0, 80));
ok("в напоминании кнопки «Подробнее» и «Не присылать»", rm.body.reply_markup.inline_keyboard.flat().map((b) => b.callback_data).join() === "r:" + RID + ",u:" + RID);
r = await remind(); ok("повторно сразу — нельзя (не чаще раза в 12 часов)", r.status === 429);
// автонапоминание по понедельникам
let rec = JSON.parse(kv.get("s:" + RID)); rec.rem = 0; rec.data.auto = "week"; kv.set("s:" + RID, JSON.stringify(rec));
calls.length = 0; let rn = await runReminders(envS, Date.parse("2026-10-14T07:10:00Z"));     // среда
ok("автонапоминание не в понедельник — не шлёт", rn === 0 && calls.length === 0);
rn = await runReminders(envS, Date.parse("2026-10-19T07:10:00Z"));                            // пн 10:10 МСК
ok("понедельник, 10 утра — напоминает", rn === 1);
rn = await runReminders(envS, Date.parse("2026-10-19T07:40:00Z"));
ok("и только один раз", rn === 0);
rec = JSON.parse(kv.get("s:" + RID)); rec.rem = 0; rec.data.bal = 500; kv.set("s:" + RID, JSON.stringify(rec));
rn = await runReminders(envS, Date.parse("2026-10-26T07:10:00Z"));
ok("долга нет — не напоминает", rn === 0);
r = await remind(); ok("вручную при отсутствии долга — понятная ошибка", r.status === 409);
calls.length = 0;
await worker.fetch(new Request("https://bot.example.workers.dev/hook", { method: "POST", headers: { "X-Telegram-Bot-Api-Secret-Token": env.WEBHOOK_SECRET }, body: JSON.stringify({ callback_query: { id: "q2", data: "u:" + RID, message: { chat: { id: 501 }, message_id: 9 } } }) }), envS);
ok("родитель может отписаться одной кнопкой", !JSON.parse(kv.get("s:" + RID)).subs.includes(501));


console.log("\nДиагностика сводки");
globalThis.fetch = async (u, o) => { const b = JSON.parse(o.body); calls.push({ method: u.split("/").pop(), body: b }); return { json: async () => (u.endsWith("getWebhookInfo") ? { ok: true, result: { url: "https://x/hook" } } : { ok: true }) }; };
kv.delete("meta:cron");
r = await worker.fetch(new Request("https://bot.example.workers.dev/status?key=" + env.WEBHOOK_SECRET), envS); let st = await r.text();
ok("статус подсказывает, что запуск по часам не включён", st.includes("ещё ни разу") && st.includes("Cron"));
await worker.scheduled({ scheduledTime: Date.parse("2026-10-14T05:00:00Z") }, envS, { waitUntil: async (p) => p });
await new Promise((res) => setTimeout(res, 20));
r = await worker.fetch(new Request("https://bot.example.workers.dev/status?key=" + env.WEBHOOK_SECRET), envS); st = await r.text();
ok("после запуска статус показывает время последнего срабатывания", st.includes("последний раз 14.10"), st);
await postD({ initData: init, data: dig, hour: 8, tz: -180 });
calls.length = 0; r = await worker.fetch(new Request("https://bot.example.workers.dev/test-digest?key=" + env.WEBHOOK_SECRET), envS);
ok("проверочная сводка уходит сразу", (await r.text()).includes("Отправлено сводок: 1") && calls.some((c) => c.body.chat_id === 777 && c.body.text.startsWith("Проверка сводки")));
r = await worker.fetch(new Request("https://bot.example.workers.dev/test-digest?key=nope"), envS);
ok("без ключа проверочную сводку не отправить", r.status === 403);


console.log("\nНапоминание о занятии");
const LID = "LessonLessonLesson_456", LWK = "lesson_write_key_lesson_write_k";
await post({ id: LID, data: { ...data, name: "Вера", lr: "eve", tz: -180, up: [{ date: "2026-10-15", t: "16:00", tp: "Алгебра" }, { date: "2026-10-17", t: "13:00" }] } }, LWK);
await hookS({ chat: { id: 601, type: "private" }, from: { first_name: "Мама" }, text: "/start p_" + LID });
calls.length = 0; let ln = await runLessonReminders(envS, Date.parse("2026-10-14T15:10:00Z"));   // 18:10 МСК
ok("до 19:00 не напоминает", ln === 0);
ln = await runLessonReminders(envS, Date.parse("2026-10-14T16:10:00Z"));                           // 19:10 МСК
const lm = calls.find((c) => c.body.chat_id === 601);
ok("накануне в 19:00 — «Завтра, четверг, 15.10, в 16:00 · Алгебра»", ln >= 1 && lm && lm.body.text.includes("Завтра, четверг, 15.10, в 16:00 · Алгебра"), lm && lm.body.text);
ln = await runLessonReminders(envS, Date.parse("2026-10-14T16:40:00Z"));
ok("одно напоминание на занятие", ln === 0);
calls.length = 0; ln = await runLessonReminders(envS, Date.parse("2026-10-15T16:10:00Z"));        // накануне 16.10 — занятий нет
ok("если завтра занятий нет — молчит", ln === 0 && calls.length === 0);
let lrec = JSON.parse(kv.get("s:" + LID)); lrec.data.lr = "morn"; lrec.lsent = ""; kv.set("s:" + LID, JSON.stringify(lrec));
calls.length = 0; ln = await runLessonReminders(envS, Date.parse("2026-10-17T06:10:00Z"));        // сб 9:10 МСК
ok("режим «в день занятия» — утром «Сегодня, суббота, 17.10, в 13:00»", ln >= 1 && calls.some((c) => c.body.text.includes("Сегодня, суббота, 17.10, в 13:00")));
lrec = JSON.parse(kv.get("s:" + LID)); lrec.data.lr = ""; lrec.lsent = ""; kv.set("s:" + LID, JSON.stringify(lrec));
ln = await runLessonReminders(envS, Date.parse("2026-10-14T16:10:00Z"));
ok("выключено — не напоминает", ln === 0);

// ---------- пробники у родителя ----------
{
  const d = { name: "Саша", bal: -3000, months: [], scores: [{ d: "05.09", exam: "ЕГЭ", score: 52, max: 100 }, { d: "03.10", exam: "ЕГЭ", score: 61, max: 100 }, { d: "17.10", exam: "ЕГЭ", score: 68, max: 100 }], goal: 80, goalExam: "ЕГЭ" };
  ok("родитель в боте видит «52 → 61 → 68 из 100, цель 80»", shareText(d, 10).includes("Пробники ЕГЭ: 52 → 61 → 68 из 100, цель 80"), shareText(d, 10));
  const html = sharePage(d);
  ok("на странице — график с тремя точками и линией цели", (html.match(/<circle/g) || []).length === 3 && html.includes("цель 80") && html.includes("Пробники ЕГЭ"));
  ok("без пробников — ничего лишнего", !shareText({ ...d, scores: [] }, 10).includes("Пробники") && !sharePage({ ...d, scores: undefined }).includes("<svg"));
  ok("ОГЭ отдельно, цель ЕГЭ к нему не цепляется", scoreLines({ ...d, scores: [{ d: "1", exam: "ОГЭ", score: 20, max: 31 }] })[0] === "📈 Пробники ОГЭ: 20 из 31");
}
ok("оплата на несколько месяцев: «занятия оплачены до конца декабря»", balanceLines({ bal: 9000, per: 1000, until: "до конца декабря" }).join(" ").includes("Оплачено вперёд: <b>9 000 ₽</b> — занятия оплачены до конца декабря"), balanceLines({ bal: 9000, per: 1000, until: "до конца декабря" }).join(" "));
// ---------- счётчик пользователей ----------
{
  const meta = new Map();
  const put0 = KV.put; KV.put = async (k, v, o) => { kv.set(k, v); if (o && o.metadata) meta.set(k, o.metadata); };
  KV.list = async ({ prefix }) => ({ keys: [...kv.keys()].filter((k) => k.startsWith(prefix)).map((name) => ({ name, metadata: meta.get(name) })), list_complete: true });
  const ping = (id, v) => savePing(new Request("https://x/ping", { method: "POST", body: JSON.stringify({ id, v }) }), envS);
  ok("пинг принят", (await ping("a1b2c3d4e5f60708", "2026.10.21")).status === 204);
  await ping("a1b2c3d4e5f60708", "2026.10.21");                                   // повтор в тот же день
  await ping("ffffeeeeddddcccc", "2026.10.05");
  ok("плохой номер отклонён (имена не принимаем)", (await ping("Никита", "1")).status === 400);
  const old = new Date(Date.now() - 10 * 864e5).toISOString().slice(0, 10);
  kv.set(`a:${old}:0123456789abcdef`, "2026.10.05"); meta.set(`a:${old}:0123456789abcdef`, { v: "2026.10.05" });
  const u = (await usageLines(envS, Date.now())).join("\n");
  ok("сегодня 2, за 7 дней 2, за 30 дней 3", u.includes("сегодня 2 · за 7 дней 2 · за 30 дней 3"), u);
  ok("разбивка по версиям", u.includes("2026.10.21 — 1") && u.includes("2026.10.05 — 1"), u);
  ok("в записи только номер и версия", [...kv.keys()].filter((k) => k.startsWith("a:")).every((k) => /^a:\d{4}-\d\d-\d\d:[a-f0-9]+$/.test(k)));
  KV.put = put0;
}

console.log(fail ? `\nПРОВАЛЕНО: ${fail}` : `\nБот: все проверки пройдены (${pass})`);
process.exit(fail ? 1 : 0);
