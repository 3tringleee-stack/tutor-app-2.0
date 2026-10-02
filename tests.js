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
  eq("в сверке ровно одна должница", T.payCheck("2026-10").filter(r=>r.status==="none"||r.status==="part").length, 1);
  const rows=T.registryRows("2026-10"), h=rows[0];
  const kat=rows.find(r=>r[0]==="Катя");
  eq("реестр: колонка «С прошлого месяца» = аванс Кати 5000", kat[h.indexOf("С прошлого месяца, ₽")], 5000);
  eq("реестр: Кате доплачивать нечего", kat[h.indexOf("Осталось оплатить, ₽")], 0);
}

console.log("\n" + (fail? `ПРОВАЛЕНО: ${fail}, пройдено: ${pass}` : `Все проверки пройдены: ${pass}`));
process.exit(fail?1:0);
