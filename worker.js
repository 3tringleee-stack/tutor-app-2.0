// Табель — бот: отвечает на /start и /help, ничего не хранит.
// Работает на Cloudflare Workers (бесплатно). Настройки задаются в Cloudflare,
// в коде их нет:
//   BOT_TOKEN       — токен бота от @BotFather (тип «Secret»)
//   APP_URL         — адрес приложения на GitHub Pages, https://… (тип «Text»)
//   WEBHOOK_SECRET  — любая строка из латиницы и цифр, 20+ символов (тип «Secret»)
//   AUTHOR_TG       — ваш ник в Telegram без @, необязательно (тип «Text»)
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

async function tg(env, method, body) {
  const r = await fetch(`https://api.telegram.org/bot${env.BOT_TOKEN}/${method}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  return r.json();
}

async function onUpdate(update, env) {
  const msg = update.message;
  if (!msg || !msg.chat || msg.chat.type !== "private") return;   // только личные чаты
  const text = (msg.text || "").trim();
  const chat_id = msg.chat.id;
  const markup = openButton(env.APP_URL);
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
      const hook = await tg(env, "setWebhook", { url: `${url.origin}/hook`, secret_token: env.WEBHOOK_SECRET, allowed_updates: ["message"], drop_pending_updates: true });
      const cmds = await tg(env, "setMyCommands", { commands: [
        { command: "start", description: "Открыть Табель" },
        { command: "help", description: "Как пользоваться" },
      ] });
      const ok = hook.ok && cmds.ok;
      return new Response(ok ? "Готово: бот подключён. Напишите ему /start.\nКнопка «Открыть Табель» ведёт на: " + env.APP_URL : "Ошибка: " + JSON.stringify({ hook, cmds }),
        { status: ok ? 200 : 500, headers: { "content-type": "text/plain; charset=utf-8" } });
    }

    // Сообщения от Telegram
    if (request.method === "POST" && url.pathname === "/hook") {
      if (request.headers.get("X-Telegram-Bot-Api-Secret-Token") !== env.WEBHOOK_SECRET) return new Response("forbidden", { status: 403 });
      try { await onUpdate(await request.json(), env); } catch (e) { /* не роняем вебхук: Telegram будет повторять */ }
      return new Response("ok");
    }

    return new Response("Табель-бот работает.", { headers: { "content-type": "text/plain; charset=utf-8" } });
  },
};
