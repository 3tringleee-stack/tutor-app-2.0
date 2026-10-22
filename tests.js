const {store}=require("./test-dom.js");
store["tutor-ui"]=JSON.stringify({reportDay:1});
store["tutor-ledger-v1"]=JSON.stringify({students:[],months:{}});
/* вынимаем скрипт из index.html и подключаем его */
const fs=require("fs"), path=require("path"), vm=require("vm");
const html=fs.readFileSync(path.join(__dirname,"index.html"),"utf8");
const code=html.slice(html.indexOf("<script>\n(function()")+8, html.lastIndexOf("</script>"));
const mod={exports:{}};
vm.runInThisContext("(function(module){"+code+"})")(mod);
const {_t}=mod.exports;
const T=_t;

let pass=0, fail=0;
const eq=(name,got,want)=>{ const ok=JSON.stringify(got)===JSON.stringify(want);
  if(ok){pass++; console.log("  ✓",name);} else {fail++; console.log("  ✗",name,"\n     получено:",JSON.stringify(got),"\n     ожидалось:",JSON.stringify(want));} };
const near=(name,got,want)=>eq(name,Math.round(got),Math.round(want));
const S=(o)=>Object.assign({id:"s1",name:"Тест",last:"",group:"",price:1000,hours:1,mode:"after",prices:[],sched:[],archived:false},o);
const sch=(days,time,dur,from)=>[{from:from||"2026-09-01",days,times:days.reduce((a,d)=>(a[d]=time,a),{}),durs:days.reduce((a,d)=>(a[d]=dur,a),{})}];

console.log("\n1. Перенос занятия из сентября в октябрь");
{
  T.set([S({id:"a",name:"Аня",price:1000,hours:1,sched:sch([2],"17:00",1)})],{});
  // занятие 29.09 перенесено на 02.10 и проведено
  T.change(()=>{
    T.add({id:"m1",sid:"a",date:"2026-09-29",type:"moved",planned:true,time:"17:00",hours:1,toDate:"2026-10-02",toTime:"18:00",child:"c1"});
    T.add({id:"c1",sid:"a",date:"2026-10-02",slot:"makeup",type:"lesson",time:"18:00",hours:1,price:1000,fromDate:"2026-09-29"});
  });
  const st=T.students()[0];
  near("сентябрь: стоимость 0", T.monthStats(st,"2026-09").cost, 0);
  near("октябрь: стоимость 1000", T.monthStats(st,"2026-10").cost, 1000);
  eq("октябрь: проведено 1", T.monthStats(st,"2026-10").held, 1);
  near("общий баланс −1000", T.balanceOf(st).balance, -1000);
}

console.log("\n2. Смена цены с даты — прошлое не пересчитывается");
{
  T.set([S({id:"b",name:"Боря",price:1200,prices:[{from:"2026-09-01",price:1000},{from:"2026-10-01",price:1200}],sched:sch([2],"17:00",1)})],{});
  const st=T.students()[0];
  eq("ставка в сентябре 1000", T.rateAt(st,"2026-09-15"), 1000);
  eq("ставка в октябре 1200", T.rateAt(st,"2026-10-15"), 1200);
  T.change(()=>T.add({id:"l1",sid:"b",date:"2026-09-15",type:"lesson",planned:true,hours:1,price:1000}));
  near("сентябрьское занятие стоит 1000", T.monthStats(st,"2026-09").cost, 1000);
}

console.log("\n3. Пробное занятие — бесплатно");
{
  T.set([S({id:"c",name:"Вика",price:1500,sched:[]})],{});
  T.change(()=>T.add({id:"t1",sid:"c",date:"2026-10-02",type:"lesson",hours:1,price:1500,trial:true}));
  const st=T.students()[0];
  near("стоимость пробного 0", T.monthStats(st,"2026-10").cost, 0);
  eq("занятие учтено как проведённое", T.monthStats(st,"2026-10").held, 1);
  near("баланс не ушёл в минус", T.balanceOf(st).balance, 0);
}

console.log("\n4. Разовый ученик без расписания");
{
  T.set([S({id:"d",name:"Гриша",price:900,oneoff:true,sched:[]})],{});
  T.change(()=>T.add({id:"l2",sid:"d",date:"2026-10-02",type:"lesson",hours:2,price:900}));
  const st=T.students()[0];
  near("разовое занятие 1800", T.monthStats(st,"2026-10").cost, 1800);
  eq("план по расписанию пуст", T.planOf(st,"2026-10").count, 0);
}

console.log("\n5. Пара: отмена с оплатой у обоих по своей ставке");
{
  const sc=sch([5],"18:00",1.5);
  T.set([S({id:"p1",name:"Катя",price:1000,hours:1.5,pair:"p2",sched:sc}),
         S({id:"p2",name:"Саша",price:1200,hours:1.5,pair:"p1",sched:sc})],{});
  T.change(()=>{
    T.add({id:"x1",sid:"p1",date:"2026-10-02",type:"cancel",status:"charged",planned:true,hours:1.5,price:1000});
    T.add({id:"x2",sid:"p2",date:"2026-10-02",type:"cancel",status:"charged",planned:true,hours:1.5,price:1200});
  });
  const [a,b]=T.students();
  near("Катя −1500", T.balanceOf(a).balance, -1500);
  near("Саша −1800", T.balanceOf(b).balance, -1800);
}

console.log("\n6. Группа: отмена у одного не трогает остальных");
{
  const sc=sch([5],"18:00",1.5);
  T.set([S({id:"g1",name:"Пётр",group:"9 класс",price:800,hours:1.5,sched:sc}),
         S({id:"g2",name:"Аня",group:"9 класс",price:800,hours:1.5,sched:sc}),
         S({id:"g3",name:"Рома",group:"9 класс",price:800,hours:1.5,sched:sc})],{});
  const day="2026-10-02";
  const slots=T.slotsOn(day);
  eq("в группе 3 слота", slots.length, 3);
  eq("сгруппированы в одну строку", T.groupSlots(slots).length, 1);
  T.markDone(slots.filter(x=>x.st.id!=="g3"));
  T.change(()=>T.add({id:"c3",sid:"g3",date:day,type:"cancel",status:"free",planned:true,hours:1.5,price:800}));
  const [p,a,r]=T.students();
  near("Пётр −1200", T.balanceOf(p).balance, -1200);
  near("Аня −1200", T.balanceOf(a).balance, -1200);
  near("Рома 0 (отмена без оплаты)", T.balanceOf(r).balance, 0);
}

console.log("\n7. Снятие отметки возвращает исходное состояние");
{
  T.set([S({id:"u1",name:"Уля",price:1000,hours:1,sched:sch([5],"19:00",1)})],{});
  const day="2026-10-02";
  T.markDone(T.slotsOn(day));
  near("после отметки −1000", T.balanceOf(T.students()[0]).balance, -1000);
  const ev=T.slotsOn(day)[0].ev;
  T.undoSlot(ev);
  near("после отмены отметки 0", T.balanceOf(T.students()[0]).balance, 0);
  eq("слот снова не отмечен", T.slotStatus(T.slotsOn(day)[0]), "open");
}

console.log("\n8. Правка длительности до отметки меняет сумму");
{
  T.set([S({id:"w1",name:"Женя",price:1000,hours:1,sched:sch([5],"19:00",1)})],{});
  const day="2026-10-02";
  T.change(()=>T.add({id:"tw",sid:"w1",date:day,type:"tweak",planned:true,time:"19:00",hours:2}));
  const sl=T.slotsOn(day)[0];
  eq("слот считается неотмеченным", T.slotStatus(sl), "open");
  eq("длительность стала 2 ч", sl.hours, 2);
  T.markDone([sl]);
  near("списано 2000", T.balanceOf(T.students()[0]).balance, -2000);
}

console.log("\n9. Сверка оплат и реестр");
{
  T.set([S({id:"r1",name:"Рита",price:1000,hours:1,mode:"after",sched:sch([5],"19:00",1)})],
        {"2026-10":[{id:"pp",sid:"r1",date:"2026-10-02",type:"payment",amount:1000}]});
  T.markDone(T.slotsOn("2026-10-02"));
  const pc=T.payCheck("2026-10")[0];
  eq("статус «оплачено»", pc.status, "ok");
  const rows=T.registryRows("2026-10");
  eq("в реестре 3 строки (шапка, ученик, итого)", rows.length, 3);
  eq("итоговая строка", rows[2][0], "ИТОГО");
  near("итог начислено = строке ученика", rows[2][5], rows[1][5]);
}

console.log("\n10. Выгрузка Excel");
{
  const rows=[["A","B"],["текст",1500]];
  const bytes=T.xlsxBytes("Лист",rows,{widths:[10,10],money:[1]});
  eq("файл начинается с сигнатуры PK", [bytes[0],bytes[1]], [80,75]);
  const out=require("path").join(__dirname,"proverka.xlsx");
  require("fs").writeFileSync(out,Buffer.from(bytes));
  console.log("  → файл proverka.xlsx записан рядом с тестом,",bytes.length,"байт");
}

console.log("\n11. Период отчёта");
{
  eq("при настройке «1-го числа» отчёт за прошлый месяц", T.reportPeriodFor("2026-10"), "2026-09");
}

console.log("\n12. Занятие 45 минут и отчёт родителю с датами");
{
  T.set([{id:"s1",name:"Вера",price:1600,hours:0.75,sched:[],archived:false}],{"2026-10":[
    {id:"a",sid:"s1",type:"lesson",date:"2026-10-06",hours:0.75,price:1600,comment:"дроби"},
    {id:"b",sid:"s1",type:"lesson",date:"2026-10-02",hours:1.25,price:1600}]});
  const st=T.students()[0], txt=T.parentText(st,"2026-10");
  eq("45 минут стоят 1200 ₽", T.costOf(T.months()["2026-10"][0],st), 1200);
  eq("в отчёте дата и заметка", txt.includes("• 06.10, 45 мин — дроби"), true);
  eq("в отчёте 1 ч 15 мин, по порядку дат", txt.indexOf("• 02.10, 1 ч 15 мин") < txt.indexOf("• 06.10"), true);
}

console.log("\n13. Сверка учитывает аванс и долг с прошлых месяцев");
{
  T.set([
    S({id:"k",name:"Катя",price:1200,mode:"after",sched:sch([5],"16:00",1)}),
    S({id:"a",name:"Саша",price:1000,mode:"month",sched:sch([2],"17:00",1.5,"2026-10-01")}),
    S({id:"v",name:"Вера",price:1500,mode:"after",sched:sch([4],"17:00",1)}),
    S({id:"g",name:"Глеб",price:1200,mode:"month",sched:sch([6],"12:00",1,"2026-10-01")}),
  ],{
    "2026-09":[{id:"kp",sid:"k",type:"payment",date:"2026-09-10",amount:5000},
               {id:"ap",sid:"a",type:"payment",date:"2026-09-28",amount:6000},
               {id:"vl",sid:"v",type:"lesson",planned:true,date:"2026-09-24",time:"17:00",hours:1,price:1500}],
    "2026-10":[{id:"kl",sid:"k",type:"lesson",planned:true,date:"2026-10-02",time:"16:00",hours:1,price:1200},
               {id:"vl2",sid:"v",type:"lesson",planned:true,date:"2026-10-01",time:"17:00",hours:1,price:1500}]});
  const pc=Object.fromEntries(T.payCheck("2026-10").map(r=>[r.st.name,r]));
  eq("Катя заплатила 5000 в сентябре — в октябре не должница", pc["Катя"].status, "ok");
  eq("Саша оплатил октябрь заранее (6000 в сентябре) — не должник", pc["Саша"].status, "ok");
  eq("Вера должна и за сентябрь, и за октябрь", [pc["Вера"].status, pc["Вера"].left], ["none", 3000]);
  eq("Глеб платит за месяц вперёд, занятий ещё не было — «ждём оплату», а не долг", [pc["Глеб"].status, pc["Глеб"].owed, pc["Глеб"].wait], ["wait", 0, 5*1200]);
  eq("в сверке ровно одна должница", T.payCheck("2026-10").filter(r=>r.status==="none"||r.status==="part").length, 1);
  const rows=T.registryRows("2026-10"), h=rows[0];
  const kat=rows.find(r=>r[0]==="Катя");
  eq("реестр: колонка «С прошлого месяца» = аванс Кати 5000", kat[h.indexOf("С прошлого месяца, ₽")], 5000);
  eq("реестр: Кате доплачивать нечего", kat[h.indexOf("Осталось оплатить, ₽")], 0);
}

console.log("\n14. Два устройства: слияние записей без потерь");
{
  const H=o=>T.hstr(JSON.stringify(o));
  const A={id:"a",date:"2026-10-01",type:"lesson",comment:""}, B={id:"b",date:"2026-10-02",type:"lesson",comment:""};
  const base={a:H(A), b:H(B)};
  const ids=l=>l.map(e=>e.id).sort().join(",");
  // телефон добавил C, компьютер ничего не знает о нём и добавил D
  const C={id:"c",date:"2026-10-03",type:"lesson"}, D={id:"d",date:"2026-10-04",type:"payment",amount:1000};
  eq("добавленное на обоих устройствах сохраняется", ids(T.mergeById([A,B,D],[A,B,C],base)), "a,b,c,d");
  eq("удалённое здесь не воскрешается из облака", ids(T.mergeById([B],[A,B],base)), "b");
  eq("удалённое на другом устройстве не возвращается отсюда", ids(T.mergeById([A,B],[B],base)), "b");
  const B2={...B,comment:"дроби"};
  eq("правка с телефона не затирается старой копией компьютера", T.mergeById([A,B],[A,B2],base).find(e=>e.id==="b").comment, "дроби");
  eq("правка здесь побеждает неизменённую копию в облаке", T.mergeById([A,B2],[A,B],base).find(e=>e.id==="b").comment, "дроби");
  eq("без истории синхронизации — объединение, ничего не теряется", ids(T.mergeById([A,D],[B,C],null)), "a,b,c,d");
}

console.log("\n15. Тексты для родителей — без машинных оборотов");
{
  T.set([
    S({id:"p",name:"Петя",parent:"Ольга",price:1000,mode:"after",sched:sch([1],"17:00",1)}),
    S({id:"q",name:"Даша",price:1000,mode:"month",sched:sch([2],"17:00",1)}),
    S({id:"z",name:"Зоя",price:1000,mode:"prepaid",sched:sch([3],"17:00",1)}),
  ],{"2026-10":[{id:"c1",sid:"q",type:"cancel",status:"charged",planned:true,date:"2026-10-06",time:"17:00",hours:1},
                {id:"pz",sid:"z",type:"payment",date:"2026-10-01",amount:4000}]});
  const [P,Q,Z]=T.students();
  const tp=T.parentText(P,"2026-10"), tq=T.parentText(Q,"2026-10");
  eq("месяц без занятий: «занятий не было», без «0 занятий»", tp.includes("в октябре занятий не было") && !/\b0 занятий/.test(tp), true);
  eq("только отмена с оплатой: «Итого за месяц», без «0 занятий, 0 ч»", /Итого за месяц: 1\s000/.test(tq) && !/(^|\D)0 ч/.test(tq), true);
  eq("обращение к родителю по имени, с новой строки", tp.startsWith("Добрый день, Ольга!\n"), true);
  eq("отчёт не нужен тому, у кого в месяце ничего не было", T.hasReport(P,"2026-10"), false);
  eq("отчёт нужен тому, у кого был платёж", !!T.hasReport(Z,"2026-10"), true);
  eq("приглашение коллеге без «С уважением»", T.tplText("invite",P).includes("С уважением"), false);
  eq("при авансе не просим оплатить", T.tplText("pay",Z).includes("ничего оплачивать не нужно"), true);
  eq("в шаблонах нет имени ребёнка в скобках", /\(Петя\)/.test(T.tplText("remind",P)+T.tplText("move",P)), false);
  eq("договор в реестре: «№ 12 от 01.09.2026»", T.contractStr({contractNo:"12",contractDate:"2026-09-01"}), "№ 12 от 01.09.2026");
}

{
  console.log("\n16. Заметка с прошлого занятия видна на следующем");
  T.set([S({id:"n",name:"Нина",price:1000,sched:sch([2],"17:00",1)}),S({id:"o",name:"Оля",price:1000,sched:sch([2],"18:00",1)})],{"2026-10":[
    {id:"x1",sid:"n",type:"lesson",date:"2026-10-06",comment:"Дроби. Задано № 1–5"},
    {id:"x2",sid:"n",type:"lesson",date:"2026-10-13",comment:""},
    {id:"x3",sid:"o",type:"lesson",date:"2026-10-10",comment:"Чужая заметка"},
    {id:"x4",sid:"n",type:"cancel",status:"free",date:"2026-10-16",comment:"Заболела"}]});
  eq("на 20.10 видно, что задали 06.10", (T.prevNote("n","2026-10-20")||{}).comment, "Дроби. Задано № 1–5");
  eq("пустая заметка 13.10 и отмена не перекрывают", (T.prevNote("n","2026-10-20")||{}).date, "2026-10-06");
  eq("заметка самого занятия не считается «прошлым разом»", T.prevNote("n","2026-10-06"), null);
  eq("заметки другого ученика не подмешиваются", (T.prevNote("o","2026-10-20")||{}).comment, "Чужая заметка");
}

{
  console.log("\n17. Темы занятий: алгебра по вторникам, геометрия по четвергам");
  // 2026-10-06 — вторник, 2026-10-08 — четверг
  T.set([S({id:"t",name:"Тёма",price:1000,subj:{2:"Алгебра",4:"Геометрия"},sched:sch([2,4],"17:00",1)})],{"2026-10":[
    {id:"a1",sid:"t",type:"lesson",date:"2026-10-06",comment:"Логарифмы, № 5.12–5.20"},
    {id:"g1",sid:"t",type:"lesson",date:"2026-10-08",comment:"Сечения куба"},
    {id:"a2",sid:"t",type:"lesson",date:"2026-10-09",topic:"Алгебра",comment:"Доп. занятие: показательные уравнения"},
    {id:"g2",sid:"t",type:"lesson",date:"2026-10-01",topic:"",comment:"Без темы"}]});
  eq("тема берётся из дня недели", T.topicOf({sid:"t",date:"2026-10-13"}), "Алгебра");
  eq("во вторник видна прошлая алгебра, а не геометрия", (T.prevNote("t","2026-10-13","Алгебра")||{}).id, "a2");
  eq("в четверг видна прошлая геометрия", (T.prevNote("t","2026-10-15","Геометрия")||{}).comment, "Сечения куба");
  eq("занятию можно задать тему вручную", T.topicOf({sid:"t",date:"2026-10-09",topic:"Алгебра"}), "Алгебра");
  eq("без темы — последняя заметка любого занятия", (T.prevNote("t","2026-10-20","")||{}).id, "a2");
}

{
  console.log("\n18. Ссылка для родителя: что попадает в снимок");
  T.set([S({id:"p",name:"Аня",last:"Иванова",price:1200,hours:1,mode:"after",share:{id:"x".repeat(22),wk:"k".repeat(32),notes:false},sched:sch([2],"16:00",1)})],{"2026-10":[
    {id:"l1",sid:"p",type:"lesson",date:"2026-10-06",time:"16:00",hours:1,comment:"Дроби"},
    {id:"c1",sid:"p",type:"cancel",status:"free",date:"2026-10-08",time:"16:00"},
    {id:"m1",sid:"p",type:"moved",date:"2026-10-09",time:"16:00",toDate:null},
    {id:"y1",sid:"p",type:"payment",date:"2026-10-02",amount:2400}]});
  const sn=T.shareSnapshot(T.students()[0]);
  const rows=(sn.months.find(m=>/Октябрь/.test(m.label))||{rows:[]}).rows;
  eq("в снимке только имя, без фамилии", sn.name+"|"+JSON.stringify(sn).includes("Иванова"), "Аня|false");
  eq("баланс: оплачено 2400, проведено 1200", sn.bal, 1200);
  eq("проведённое занятие со стоимостью", rows.some(r=>r.k==="done"&&r.sum===1200&&r.d==="06.10"), true);
  eq("отмена без оплаты и оплата видны", rows.some(r=>r.k==="cfree")&&rows.some(r=>r.k==="pay"&&r.sum===2400), true);
  eq("заметки скрыты, пока их не включили", rows.find(r=>r.k==="done").note, "");
  eq("ключ записи в снимок не попадает", JSON.stringify(sn).includes("kkkk"), false);
  eq("в снимке ближайшие занятия с датами для напоминаний", Array.isArray(sn.up) && sn.up.every(x=>/^\d{4}-\d{2}-\d{2}$/.test(x.date)), true);
  // «платит за месяц»: родителю — реальный долг за проведённые, а не весь план месяца
  T.set([S({id:"q",name:"Саша",price:1500,hours:1,mode:"month",share:{id:"y".repeat(22),wk:"k".repeat(32)},sched:sch([2,6],"13:00",1)})],{"2026-09":[
    {id:"a",sid:"q",type:"payment",date:"2026-09-08",amount:10500},
    ...["01","05","08","12","15","19"].map((d,i)=>({id:"s"+i,sid:"q",type:"lesson",date:"2026-09-"+d,hours:1}))],
    "2026-10":["03","06","10"].map((d,i)=>({id:"o"+i,sid:"q",type:"lesson",date:"2026-10-"+d,hours:1}))});
  const sq=T.shareSnapshot(T.students()[0]);
  eq("месячная оплата: родитель видит долг 3 000 ₽, а не план октября", sq.bal+"|"+("pay" in sq), "-3000|false");
}

{
  console.log("\n19. Чередование предметов без расписания тем");
  // вт 06.10 алгебра, чт 08.10 геометрия (темы выбраны на уроках), сегодня вт 13.10
  T.set([S({id:"z",name:"Зоя",price:1000,sched:sch([2,4],"17:00",1)})],{"2026-10":[
    {id:"a1",sid:"z",type:"lesson",date:"2026-10-06",topic:"Алгебра",comment:"Логарифмы, д/з № 5.12"},
    {id:"g1",sid:"z",type:"lesson",date:"2026-10-08",topic:"Геометрия",comment:"Сечения, д/з 3 задачи"}]});
  const st=T.students()[0];
  eq("тема вторника угадывается по прошлому вторнику", T.inferTopic(st,"2026-10-13"), "Алгебра");
  eq("тема четверга — по прошлому четвергу", T.inferTopic(st,"2026-10-15"), "Геометрия");
  eq("видны последние заметки по обоим предметам", T.lastNotesByTopic("z","2026-10-13").map(x=>x.t).join(","), "Геометрия,Алгебра");
  const h=T.notesBlockHtml("z","2026-10-13","Алгебра");
  eq("главная — алгебра, геометрия свёрнута ниже", h.indexOf("Логарифмы")<h.indexOf("Сечения") && h.includes('class="nt other"'), true);
}

{
  console.log("\n20. Предметы репетитора и подсказки тем");
  T.setUI({subjects:[]});
  eq("без выбора — математика и её темы", T.topicPresets(null).slice(0,3).join(","), "Математика,ОГЭ,ЕГЭ");
  T.setUI({subjects:["Химия"]});
  const ch=T.topicPresets(null);
  eq("химику — химические темы", ch.includes("Органика") && ch.includes("Неорганика"), true);
  eq("и никакой геометрии", ch.includes("Геометрия"), false);
  T.setUI({subjects:["Математика","Физика"]});
  const mf=T.topicPresets(null);
  eq("два предмета — сами предметы тоже темы", mf.includes("Математика") && mf.includes("Физика") && mf.includes("Механика"), true);
  eq("у ученика по физике — сначала физика", T.topicPresets({subject:"физика"})[2], "Механика");
  T.setUI({subjects:[]});
}

{
  console.log("\n21. Чеки «Мой налог» и налог за месяц");
  T.setUI({self:true, selfFrom:"2026-10-01", taxRate:4, taxService:""});
  T.set([S({id:"c",name:"Катя",price:1000,sched:sch([2],"17:00",1)})],{"2026-09":[{id:"old",sid:"c",type:"payment",date:"2026-09-20",amount:5000}],"2026-10":[
    {id:"p1",sid:"c",type:"payment",date:"2026-10-02",amount:4000},
    {id:"p2",sid:"c",type:"payment",date:"2026-10-09",amount:2500,receipt:"2026-10-09"},
    {id:"l1",sid:"c",type:"lesson",date:"2026-10-06",hours:1},
    {id:"x1",sid:"c",type:"cancel",status:"free",date:"2026-10-08",hours:1}]});
  eq("к пробитию — только оплаты после включения и без чека", T.receiptsDue().map(e=>e.id).join(), "p1");
  const tx=T.taxFor("2026-10");
  eq("налог 4% от полученного за месяц", tx.got+"|"+tx.tax, "6500|260");
  eq("чеки: 1 из 2, оплатить до 28.11", tx.done+"/"+tx.total+" "+tx.due, "1/2 28.11.2026");
  eq("название услуги с месяцем", T.serviceName("2026-10-02"), "Репетиторские услуги, октябрь 2026");
  const ys=T.yearStats("2026"), oct=ys.months12[9];
  eq("доход: заработано, получено и потеряно на отменах за октябрь", oct.c+"|"+oct.p+"|"+oct.l, "1000|6500|1000");
  T.setUI({self:false});
  eq("не самозанятый — чеки не просим", T.receiptsDue().length, 0);
}

{
  console.log("\n22. Пробники: баллы, график, родитель");
  T.set([S({id:"e",name:"Саша",goalScore:80,goalExam:"ЕГЭ",share:{id:"z".repeat(22),wk:"k".repeat(32)},scores:[
    {id:"r3",date:"2026-10-17",exam:"ЕГЭ",score:68,max:100,note:""},
    {id:"r1",date:"2026-09-05",exam:"ЕГЭ",score:52,max:100,note:"часть 2 — 3 из 7"},
    {id:"r2",date:"2026-10-03",exam:"ЕГЭ",score:61,max:100}]})],{});
  const st=T.students()[0];
  eq("результаты идут по дате", T.scoresOf(st).map(r=>r.score), [52,61,68]);
  const svg=T.scoreChart(T.scoresOf(st),80,100);
  eq("на графике 3 точки и линия цели", (svg.match(/<circle/g)||[]).length+"|"+svg.includes("цель 80"), "3|true");
  eq("без результатов графика нет", T.scoreChart([],80,100), "");
  const sn=T.shareSnapshot(st);
  eq("родителю уходят баллы и цель", sn.scores.map(r=>r.score+"/"+r.max+" "+r.d).join(", ")+" · цель "+sn.goal, "52/100 05.09, 61/100 03.10, 68/100 17.10 · цель 80");
  eq("комментарий к пробнику родителю не уходит", JSON.stringify(sn).includes("часть 2"), false);
}

{
  console.log("\n23. Оплата сразу за несколько месяцев");
  const RealDate=Date; const FIX=new RealDate(2026,9,22,12,0,0).getTime();
  global.Date=class extends RealDate{ constructor(...a){ a.length?super(...a):super(FIX); } static now(){ return FIX; } };
  try{
    T.set([S({id:"mm",name:"Лиза",price:1000,hours:1,mode:"month",sched:sch([2],"16:00",1)})],{"2026-10":[
      {id:"p0",sid:"mm",type:"payment",date:"2026-10-01",amount:4000},
      ...["06","13","20"].map((d,i)=>({id:"l"+i,sid:"mm",type:"lesson",planned:true,date:"2026-10-"+d,time:"16:00",hours:1}))]});
    const st=T.students()[0];
    eq("октябрь оплачен — «до конца октября»", (T.coverInfo(st,T.balanceOf(st).balance)||{}).text, "до конца октября");
    eq("быстрые суммы: до конца ноября / декабря / января", T.payForMonths(st,3).map(x=>x.key+":"+x.amt), ["2026-11:4000","2026-12:9000","2027-01:13000"]);
    const c=T.coverInfo(st,T.balanceOf(st).balance+9000);
    eq("после оплаты 9000 — «до конца декабря», 3 месяца", c.text+"|"+c.months, "до конца декабря|3");
    eq("неполный месяц — до даты", /^по 10\.11(\.2026)? включительно$/.test(T.coverInfo(st,T.balanceOf(st).balance+2000).text), true);
    T.change(()=>T.add({id:"p1",sid:"mm",type:"payment",date:"2026-10-22",amount:9000}));
    eq("в снимке для родителя — до какого месяца оплачено", T.shareSnapshot(T.students()[0]).until, "до конца декабря");
    const pt=T.parentText(T.students()[0],"2026-10");
    eq("месячный отчёт: «уже оплачены до конца декабря, доплачивать не нужно»", pt.includes("Занятия уже оплачены до конца декабря, доплачивать не нужно"), true);
  } finally { global.Date=RealDate; }
}

console.log("\n" + (fail? `ПРОВАЛЕНО: ${fail}, пройдено: ${pass}` : `Все проверки пройдены: ${pass}`));
process.exit(fail?1:0);
