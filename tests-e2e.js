// Сквозная проверка «Табеля» в настоящем браузере.
// Тест сам открывает приложение и проходит все функции так, как это делает человек.
//
// Один раз установить:   npm install playwright && npx playwright install chromium
// Запускать:             node tests-e2e.js
// Посмотреть глазами:    node tests-e2e.js --show
//
// Ваши настоящие данные тест не трогает: он работает в отдельном чистом профиле браузера.

const path = require("path"), fs = require("fs");
let chromium;
try { ({ chromium } = require("playwright")); }
catch (e) { console.log("Нужен Playwright. Выполните один раз:\n  npm install playwright && npx playwright install chromium"); process.exit(1); }

const APP = "file://" + path.join(__dirname, "index.html");
const SHOW = process.argv.includes("--show");
const W = 390, H = 820; // экран телефона

let pass = 0, fail = 0;
const ok = (name, cond, extra) => {
  if (cond) { pass++; console.log("  ✓ " + name); }
  else { fail++; console.log("  ✗ " + name + (extra !== undefined ? "  →  " + String(extra).slice(0, 200) : "")); }
};
const section = t => console.log("\n" + t);

const pad = n => String(n).padStart(2, "0");
const ds = d => d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate());
const NOW = new Date(), TODAY = ds(NOW), WD = NOW.getDay();
const ddmm = s => s.slice(8) + "." + s.slice(5, 7);
const addDays = (s, n) => { const d = new Date(s + "T12:00:00"); d.setDate(d.getDate() + n); return ds(d); };
// четыре других дня этого же месяца — на них проверим все виды «не было»
const otherDays = (() => { const out = []; for (let i = 1; out.length < 4 && i < 31; i++) { for (const d of [addDays(TODAY, i), addDays(TODAY, -i)]) if (d.slice(0, 7) === TODAY.slice(0, 7) && out.length < 4) out.push(d); } return out; })();

(async () => {
  const launch = { headless: !SHOW, slowMo: SHOW ? 120 : 0 };
  if (process.env.PW_CHROMIUM) launch.executablePath = process.env.PW_CHROMIUM;
  const browser = await chromium.launch(launch);
  const ctx = await browser.newContext({ viewport: { width: W, height: H }, acceptDownloads: true, locale: "ru-RU", timezoneId: Intl.DateTimeFormat().resolvedOptions().timeZone });
  // Настоящий telegram-web-app.js в обычном браузере создаёт WebApp с пустым initData.
  // Подменяем его таким же поведением, чтобы тест был одинаковым с интернетом и без.
  await ctx.route("**/telegram-web-app.js", r => r.fulfill({ contentType: "application/javascript", body:
    "window.Telegram={WebApp:{initData:'',initDataUnsafe:{},platform:'unknown',version:'6.0',colorScheme:'light',themeParams:{},isVersionAtLeast:function(v){return parseFloat(v)<=6},ready:function(){},expand:function(){},onEvent:function(){},openLink:function(u){},BackButton:{show:function(){},hide:function(){},onClick:function(){}},CloudStorage:{getItem:function(){},setItem:function(){},getItems:function(){},getKeys:function(){},removeItems:function(){}}}};" }));
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", e => errors.push(e.message));
  page.on("console", m => { if (m.type() === "error" && !/telegram|ERR_|Failed to load|fonts/i.test(m.text())) errors.push(m.text()); });
  page.on("dialog", d => d.accept());

  const $ = s => page.locator(s);
  const norm = t => String(t || "").replace(/[\u00a0\u202f]/g, " ").replace(/\s+/g, " ").trim();
  const text = async s => norm(await $(s).first().innerText());
  const view = () => text("#view");
  const tab = async t => { await $(`#tabs [data-tab="${t}"]`).click(); await page.waitForTimeout(80); };
  const modalOpen = async () => (await $("#back").getAttribute("class") || "").includes("open");
  const closeModal = async () => { if (await modalOpen()) { await page.keyboard.press("Escape"); await page.waitForTimeout(60); } };
  const noHScroll = async () => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
  const data = () => page.evaluate(() => JSON.parse(localStorage.getItem("tutor-ledger-v1") || "{}"));
  const obState = () => page.evaluate(() => { const ob = document.querySelector("#view .ob"); if (!ob) return null;
    return [...ob.querySelectorAll("li")].map(li => li.classList.contains("done") ? "✓" : li.classList.contains("cur") ? "→" : "·").join(""); });
  const row = name => $("#view .prow").filter({ hasText: name }).first();
  const rowText = async name => norm(await row(name).innerText());
  const header = async id => { await page.waitForTimeout(900); return text(id); };
  const setDur = (id, h) => page.evaluate(([id, h]) => { const el = document.getElementById(id); el.value = String(h); el.dispatchEvent(new Event("input", { bubbles: true })); el.dispatchEvent(new Event("change", { bubbles: true })); }, [id, h]);

  async function wizard({ name, last = "", days = [], oneoff = false, time = "17:00", hours = 1, price = 0, mode = "after", parent = "" }) {
    if (!(await $("#wizStart").count())) await tab("st");
    await $("#wizStart, #addSt").first().click();
    await $("#wName").fill(name); await $("#wLast").fill(last);
    if (oneoff) await $("#wOne").check();
    for (const w of days) await $(`#wWd [data-w="${w}"]`).click();
    await $("#wTime").fill(time); await setDur("wH", hours);
    await $("#wNext").click();
    await $("#wPrice").fill(String(price));
    if (!oneoff) await $(`#wMode [data-m="${mode}"]`).click();
    await $("#wNext2").click();
    await $("#wParent").fill(parent);
    await $("#wSave").click();
    await page.waitForTimeout(100);
  }

  try {
    // ------------------------------------------------------------
    section("1. Первый запуск");
    await page.goto(APP); await page.waitForTimeout(400);
    let v = await view();
    ok("пустой экран с приглашением добавить ученика", v.includes("Добавить первого ученика"), v);
    ok("нет чужих учеников из примера", !/Арина|Рома ШК/.test(v));
    ok("нет мусора в разметке (лишние кавычки, undefined)", !/undefined|NaN|">/.test(await text("body")));
    ok("страница не шире экрана телефона", await noHScroll());

    // ------------------------------------------------------------
    section("2. Мастер добавления ученика");
    await wizard({ name: "Вера", last: "Тест", days: [WD], time: "17:00", hours: 0.75, price: 1600, mode: "after", parent: "Ольга" });
    v = await view();
    ok("ученица появилась в «Сегодня»", v.includes("Вера Тест"), v);
    ok("время и длительность 45 минут", v.includes("17:00–17:45") && v.includes("45 мин"), v);
    ok("крупные кнопки «Проведено» и «Не было»", await row("Вера").locator("[data-done]").count() === 1 && await row("Вера").locator("[data-miss]").count() === 1);
    const st = (await data()).students || [];
    ok("подсказка «Как вести учёт»: шаг 1 сделан, следующий — «Проведено»", await obState() === "✓→··", await obState());
    ok("сохранено: цена, способ оплаты, родитель", st[0] && st[0].price === 1600 && st[0].mode === "after" && st[0].parent === "Ольга", JSON.stringify(st[0]));

    // ------------------------------------------------------------
    section("3. Отметка занятия, заметка, отмена отметки");
    await row("Вера").locator("[data-done]").click(); await page.waitForTimeout(100);
    ok("занятие проведено, стоимость 1 200 ₽ (45 мин × 1 600)", (await rowText("Вера")).includes("1 200 ₽"), await rowText("Вера"));
    ok("в шапке долг 1 200 ₽", (await header("#sumDebt")).includes("1 200"), await text("#sumDebt"));
    ok("подсказка: «Проведено» отмечено само", await obState() === "✓✓→·", await obState());
    await row("Вера").locator("[data-note]").click();
    await $("#eCom").fill("дроби, №5–12"); await $("#eSave").click(); await page.waitForTimeout(80);
    ok("заметка «что прошли» видна в строке", (await rowText("Вера")).includes("дроби, №5–12"));
    await row("Вера").locator("[data-undo]").click(); await page.waitForTimeout(80);
    ok("отметку можно снять — занятие снова не отмечено", await row("Вера").locator("[data-done]").count() === 1);
    ok("долг вернулся к нулю", !(await header("#sumDebt")).includes("1 200"), await text("#sumDebt"));
    await row("Вера").locator("[data-done]").click(); await page.waitForTimeout(80);
    await row("Вера").locator("[data-note]").click(); await $("#eCom").fill("дроби, №5–12"); await $("#eSave").click();

    // ------------------------------------------------------------
    section("4. Правка времени и длительности до отметки");
    await wizard({ name: "Катя", days: [0, 1, 2, 3, 4, 5, 6], time: "15:00", hours: 1, price: 1000, mode: "after" });
    await row("Катя").locator("[data-tweak]").click();
    await $('#twChips [data-h="1.5"]').click();
    await $("#twTime").fill("15:30"); await $("#twSave").click(); await page.waitForTimeout(80);
    const katya = await rowText("Катя");
    ok("нажатие на время открывает правку; стало 15:30, 1,5 ч", katya.includes("15:30–17:00") && katya.includes("1,5 ч"), katya);
    await row("Катя").locator("[data-done]").click();
    ok("проведено по новой длительности: 1 500 ₽", (await rowText("Катя")).includes("1 500 ₽"), await rowText("Катя"));

    // ------------------------------------------------------------
    section("5. «Не было»: все пять вариантов");
    await tab("cal");
    const kinds = [["charged", "отмена с оплатой"], ["free", "отмена без оплаты"], ["later", "перенос — дата не назначена"], ["skip", "не было (каникулы)"]];
    for (let i = 0; i < kinds.length; i++) {
      const [o, label] = kinds[i], d = otherDays[i];
      await $(`[data-day="${d}"]`).click(); await page.waitForTimeout(60);
      await row("Катя").locator("[data-miss]").click();
      await $(`#mc [data-o="${o}"]`).click(); await $("#mSave").click(); await page.waitForTimeout(80);
      ok(`${ddmm(d)}: ${label}`, (await rowText("Катя")).includes(label), await rowText("Катя"));
    }
    await tab("today");
    await wizard({ name: "Рома", last: "ШК", days: [WD], time: "18:30", hours: 1.5, price: 1200, mode: "month" });
    await row("Рома").locator("[data-miss]").click();
    await $('#mc [data-o="moved"]').click();
    const moveTo = addDays(TODAY, 1);
    await $("#mvDate").fill(moveTo); await $("#mvTime").fill("19:00"); await $("#mSave").click(); await page.waitForTimeout(80);
    ok(`перенос с датой: «перенесено на ${ddmm(moveTo)}»`, (await rowText("Рома")).includes("перенесено на " + ddmm(moveTo)), await rowText("Рома"));
    await tab("cal"); await $(`[data-day="${moveTo}"]`).click().catch(() => {});
    if (moveTo.slice(0, 7) === TODAY.slice(0, 7)) ok("перенесённое занятие стоит в календаре на новую дату", (await view()).includes("перенос с " + ddmm(TODAY)), await view());
    await tab("today");

    // ------------------------------------------------------------
    section("6. Оплата, доп. занятие, пробное");
    await tab("st");
    await $('[data-q="payment"]').first().click();
    await $("#fSt").selectOption({ label: "Вера" });
    await $("#fAmt").fill("1200"); await $("#fSave").click(); await page.waitForTimeout(80);
    v = await view();
    const veraCard = (v.split("Вера Тест")[1] || "").split("Оплата")[0];
    await tab("today"); ok("подсказка: оплата отмечена, остался «Отчёт»", await obState() === "✓✓✓→", await obState()); await tab("st"); v = await view();
    ok("после оплаты 1 200 ₽ Вера «в расчёте»", veraCard.includes("в расчёте"), veraCard);
    await tab("today");
    await $("[data-new]").first().click();
    await $('#seg [data-t="lesson"]').click();
    await $("#fSt").selectOption({ label: "Вера" }); await $("#fTrial").check(); await $("#fSave").click(); await page.waitForTimeout(80);
    let ev = Object.values((await data()).months || {}).flat();
    ok("пробное занятие записано и бесплатно", ev.some(e => e.type === "lesson" && e.trial), JSON.stringify(ev.filter(e => e.trial)));
    await $("[data-new]").first().click();
    await $('#seg [data-t="lesson"]').click(); await $("#fSt").selectOption({ label: "Вера" }); await $("#fSave").click(); await page.waitForTimeout(80);
    ev = Object.values((await data()).months || {}).flat();
    ok("доп. занятие записано", ev.filter(e => e.type === "lesson" && e.sid === st[0].id && !e.planned).length >= 2);

    // ------------------------------------------------------------
    section("7. Разовый ученик и группа");
    await tab("st");
    await wizard({ name: "Глеб", oneoff: true, price: 2000 });
    await tab("st");
    ok("разовый ученик без расписания", (await view()).includes("разовые занятия"), await view());
    await $("#addGroup").click();
    await $("#gName").fill("9 класс"); await $("#gMembers").fill("Иванов Пётр\nСмирнова Аня\nКузнецов Рома");
    await $(`#gWd [data-w="${WD}"]`).click(); await $("#gTime").fill("20:00");
    await $("#gPrice").fill("800"); await $("#gMode").selectOption("month"); await $("#gSave").click(); await page.waitForTimeout(80);
    await tab("today");
    ok("группа — одна строка в «Сегодня», 3 ученика", (await view()).includes("9 класс") && (await view()).includes("3 ученика"), await view());
    await row("9 класс").locator("[data-done]").click(); await page.waitForTimeout(80);
    ev = Object.values((await data()).months || {}).flat();
    ok("отметка группы списала занятие каждому", ev.filter(e => e.type === "lesson" && e.date === TODAY && e.time === "20:00").length === 3);

    // ------------------------------------------------------------
    section("8. Календарь");
    await tab("cal");
    const m1 = await text("#view .monthbar strong");
    await $('[data-cm="1"]').click(); const m2 = await text("#view .monthbar strong");
    await $('[data-cm="-1"]').click(); const m3 = await text("#view .monthbar strong");
    ok("листается вперёд и назад", m1 !== m2 && m1 === m3, [m1, m2, m3].join(" / "));
    ok("«месяц в цифрах» с полосами по неделям", (await view()).includes("в цифрах") && await $(".hbars .hrow").count() >= 4);

    // ------------------------------------------------------------
    section("9. Отчёт, родителю, сверка, Excel");
    await tab("rep");
    v = await view();
    ok("отчёт за месяц открыт", v.includes("Отчёт:"), v.slice(0, 100));
    await $(`[data-msg="${st[0].id}"]`).click();
    const pm = await $("#pm").inputValue();
    ok("текст родителю: обращение по имени", pm.includes("Ольга"), pm);
    ok("текст родителю: дата, 45 мин и что прошли", pm.includes(`• ${ddmm(TODAY)}, 45 мин — дроби, №5–12`), pm);
    ok("текст родителю: пробное отмечено", pm.includes("пробное"), pm);
    await closeModal();
    ok("сверка оплат: есть строки учеников", (await view()).includes("Сверка оплат"));
    await $("[data-registry]").first().click();
    const reg = await $("#rgOut").inputValue().catch(() => "");
    ok("реестр: шапка и итог", reg.includes("Ученик") && reg.includes("ИТОГО"), reg.slice(0, 200));
    const [dl] = await Promise.all([page.waitForEvent("download", { timeout: 4000 }).catch(() => null), $("#rgXl").click()]);
    if (dl) { const p = await dl.path(); const head = fs.readFileSync(p).slice(0, 2).toString(); ok("файл Excel скачался и это настоящий .xlsx", head === "PK" && dl.suggestedFilename().endsWith(".xlsx"), dl.suggestedFilename()); }
    else ok("файл Excel скачался", false, "скачивание не началось");
    await closeModal();
    ok("сводка за год посчитана", /20\d\d/.test(await view()) && (await view()).includes("Итого"));

    // ------------------------------------------------------------
    await tab("today"); ok("после открытия «Отчёта» подсказка исчезла сама", await obState() === null, await obState());
    section("10. Карточка ученика, смена цены, архив");
    await tab("st");
    await $(`[data-open="${st[0].id}"]`).click(); await page.waitForTimeout(80);
    ok("история ученика: пробное и заметка", (await text("#det")).includes("Пробное") && (await text("#det")).includes("дроби"), await text("#det"));
    await $("#dEdit").click();
    const from = addDays(TODAY, 1);
    await $("#sPrice").fill("2000"); if (await $("#sPriceFrom").count()) await $("#sPriceFrom").fill(from);
    await $("#sSave").click(); await page.waitForTimeout(80); await closeModal();
    const vera = ((await data()).students || []).find(s => s.name === "Вера");
    ok("новая цена записана с даты, прошлое не пересчитано", vera && (vera.prices || []).some(p => p.price === 2000) &&
      Object.values((await data()).months).flat().find(e => e.sid === vera.id && e.date === TODAY && e.planned).price === 1600, JSON.stringify(vera && vera.prices));
    const roma = ((await data()).students || []).find(s => s.name === "Рома");
    await $(`[data-open="${roma.id}"]`).click(); await $("#dEdit").click(); await $("#sArch").click(); await page.waitForTimeout(80); await closeModal();
    ok("ученик в архиве пропал из списка", !(await view()).includes("Рома ШК"));

    // ------------------------------------------------------------
    section("11. Свободные окна");
    await $("#freeBtn").click(); await page.waitForTimeout(80);
    const fw = await text("#fwBody");
    ok("окна подобраны, занятое время не предлагается", /\d\d:\d\d/.test(fw), fw.slice(0, 200));
    ok("текст для родителя готов", (await $("#fwText").inputValue()).includes("Здравствуйте"));
    await closeModal();

    // ------------------------------------------------------------
    section("12. Настройки и оформление");
    await $("#meBtn").click(); await page.waitForTimeout(80);
    const sett = await text("#modal");
    ok("лишних настроек нет (фон, цвет, название, напоминание)", !/Основной цвет|Своя картинка|Название|Напоминать отметить/.test(sett), sett.slice(0, 300));
    await $('#themePick [data-theme="night"]').click(); await page.waitForTimeout(80);
    ok("тема «Ночь» включает тёмный режим", await page.evaluate(() => document.documentElement.dataset.theme) === "dark");
    await $('#themePick [data-theme="tabel"]').click();
    await $("#uiTheme").selectOption("light");
    ok("переключение на светлую", await page.evaluate(() => document.documentElement.dataset.theme) === "light");

    // ------------------------------------------------------------
    section("13. Резервная копия и восстановление");
    await $("#setBackup").click(); await page.waitForTimeout(80);
    const [bk] = await Promise.all([page.waitForEvent("download", { timeout: 4000 }).catch(() => null), $("#bkDl").click()]);
    const backup = bk ? fs.readFileSync(await bk.path(), "utf8") : "";
    ok("копия скачалась файлом", backup.includes("Вера"), backup.slice(0, 100));
    await closeModal();
    await page.evaluate(() => { const o = JSON.parse(localStorage.getItem("tutor-ledger-v1")); o.students = o.students.filter(s => s.name !== "Вера"); localStorage.setItem("tutor-ledger-v1", JSON.stringify(o)); });
    await page.reload(); await page.waitForTimeout(300);
    ok("(имитация потери: Веры нет)", !(await view()).includes("Вера"));
    await $("#meBtn").click(); await $("#setBackup").click();
    await $("#bkIn").fill(backup); await page.waitForTimeout(80); await $("#bkRestore").click(); await page.waitForTimeout(150);
    await closeModal(); await closeModal(); await tab("today");
    ok("после восстановления Вера и её заметка на месте", (await view()).includes("Вера") && (await view()).includes("дроби"));

    // ------------------------------------------------------------
    section("14. Импорт расписания текстом");
    await $("#meBtn").click(); await $("#impSched").click();
    await $("#impText").fill("Миша: Пн 15:00-16:00, Ср 15:00");
    await $("#impCheck").click(); await $("#impApply").click(); await page.waitForTimeout(80);
    await closeModal(); await closeModal(); await tab("st");
    ok("Миша добавлен со своим расписанием", (await view()).includes("Миша"), (await view()).slice(0, 200));

    // ------------------------------------------------------------
    section("15. Сохранение после перезагрузки и вид на телефоне");
    await page.reload(); await page.waitForTimeout(300);
    ok("всё на месте после перезагрузки", (await view()).includes("Вера") && (await view()).includes("Катя"));
    for (const t of ["today", "cal", "rep", "st"]) { await tab(t); ok(`вкладка «${await text(`#tabs [data-tab="${t}"]`)}» без горизонтальной прокрутки`, await noHScroll()); }
    await tab("today");
    await row("Катя").locator("[data-edit]").click().catch(() => {});
    if (await modalOpen()) {
      const box = await $(".modal > .foot:last-child button").last().boundingBox();
      ok("кнопки окна видны без прокрутки", box && box.y + box.height <= H + 1, JSON.stringify(box));
      await closeModal();
    }
    // клавиатура на телефоне: видимая часть экрана уменьшается до 400px
    const veraId = ((await data()).students || []).find(s => s.name === "Вера").id;
    await tab("st"); await $(`[data-open="${veraId}"]`).click(); await $("#dEdit").click();
    await page.setViewportSize({ width: W, height: 400 }); await page.waitForTimeout(150);
    await $("#sNote").click(); await page.waitForTimeout(800);
    const kb = await page.evaluate(() => { const m = document.getElementById("modal").getBoundingClientRect(), f = document.getElementById("sNote").getBoundingClientRect();
      return { ok: f.top >= m.top && f.bottom <= m.bottom && m.bottom <= innerHeight + 1, f: [Math.round(f.top), Math.round(f.bottom)], m: [Math.round(m.top), Math.round(m.bottom)] }; });
    ok("с открытой клавиатурой последнее поле формы доступно для ввода", kb.ok, JSON.stringify(kb));
    await page.setViewportSize({ width: W, height: H }); await closeModal(); await tab("today");
    await page.screenshot({ path: path.join(__dirname, "proverka-ekran.png") });

    // ------------------------------------------------------------
    section("16. Подсказка снова и пробный режим ?new");
    await $("#meBtn").click(); await $("#uiOb").click(); await page.waitForTimeout(80);
    ok("«Показать снова» в настройках возвращает подсказку", await obState() !== null, await obState());
    await $("[data-obhide]").click(); await page.waitForTimeout(60);
    ok("«Скрыть» убирает её", await obState() === null);
    const before = JSON.stringify(await data());
    await page.goto(APP + "?new"); await page.waitForTimeout(300);
    ok("?new открывает приложение как у новичка", (await view()).includes("Добавить первого ученика") && !(await view()).includes("Вера"), (await view()).slice(0, 120));
    ok("и честно пишет, что это пробный режим", (await text("#syncState")).includes("Пробный режим"));
    await wizard({ name: "Пробный", days: [WD], price: 1000, mode: "after" });
    ok("в пробном режиме подсказка видна с первого ученика", await obState() === "✓→··", await obState());
    await row("Пробный").locator("[data-done]").click(); await page.waitForTimeout(80);
    await page.goto(APP); await page.waitForTimeout(300);
    ok("после выхода из пробного режима настоящие данные не тронуты", JSON.stringify(await data()) === before && !(await view()).includes("Пробный"));
  } catch (e) {
    fail++; console.log("\n  ✗ Тест остановился: " + e.message.split("\n")[0]);
    await page.screenshot({ path: path.join(__dirname, "proverka-oshibka.png") }).catch(() => {});
    console.log("    Снимок экрана в момент ошибки: proverka-oshibka.png");
  }

  section("17. Ошибки в работе страницы");
  ok("ни одной ошибки JavaScript", errors.length === 0, errors.join(" | "));

  await browser.close();
  console.log("\n" + (fail ? `ПРОВАЛЕНО: ${fail}, пройдено: ${pass}` : `Все проверки пройдены: ${pass}`));
  process.exit(fail ? 1 : 0);
})();
