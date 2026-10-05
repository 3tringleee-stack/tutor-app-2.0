const sc=process.argv[2];
const {els,store,listeners}=require(require("path").join(__dirname,"test-dom.js"));
const vm=require("vm"),fs=require("fs");
// поддельное облако
const cloud={}; let failReads=0, writes=0, failPtr=0;
const CS={
  getItem:(k,cb)=>setTimeout(()=>failReads>0?(failReads--,cb("ERR")):cb(null,cloud[k]??""),1),
  getItems:(ks,cb)=>setTimeout(()=>{const m={};ks.forEach(k=>m[k]=cloud[k]??"");cb(null,m)},1),
  getKeys:cb=>setTimeout(()=>cb(null,Object.keys(cloud)),1),
  setItem:(k,v,cb)=>{ if(failPtr>0 && /__n$/.test(k)){ failPtr--; return setTimeout(()=>cb("CLOSED"),1); } if(!/^bk/.test(k)) writes++; cloud[k]=v;setTimeout(()=>cb(null,true),1)},
  removeItems:(ks,cb)=>{ks.forEach(k=>delete cloud[k]);cb&&cb(null,true)},
};
let backShown=null, closeConf=null, backCb=null, actCb=null;
global.window.Telegram={WebApp:{initData:"query_id=test&user=1",platform:"ios",ready(){},expand(){},isVersionAtLeast:()=>true,CloudStorage:CS,
  BackButton:{show(){backShown=true},hide(){backShown=false},onClick(f){backCb=f}},
  enableClosingConfirmation(){closeConf=true},disableClosingConfirmation(){closeConf=false},
  disableVerticalSwipes(){}, onEvent(n,f){ if(n==="activated") actCb=f; }, themeParams:{}, colorScheme:"light"}};
const put=(name,obj)=>{cloud[name+"__n"]="1";cloud[name+"__0"]=JSON.stringify(obj);};
// прочитать значение из облака так, как его читает приложение (новый формат с указателем или старый)
const rd=name=>{ const v=cloud[name+"__n"]; if(!v) return ""; const m=String(v).match(/^g:([0-9a-z]+):(\d+)$/);
  let out=""; const n=m?+m[2]:+v; for(let i=0;i<n;i++) out+=cloud[m?`${name}__g${m[1]}_${i}`:`${name}__${i}`]??""; return out; };
const mine=[{id:"s1",name:"Арина",price:1500,hours:1,sched:[],archived:false}];
if(sc==="fail"){ put("st",mine); put("m2026-10",[{id:"e1",type:"lesson",sid:"s1",date:"2026-10-01"}]);
  store["tutor-ledger-v1"]=JSON.stringify({students:[{id:"old",name:"Старый",sched:[]}],months:{}}); failReads=2; }
if(sc==="retry"){ put("st",mine); failReads=1; }
if(sc==="migrate"){ store["tutor-ledger-v1"]=JSON.stringify({students:mine,months:{"2026-10":[{id:"e1",type:"lesson",sid:"s1",date:"2026-10-01"}]}}); }
if(sc==="refresh"){ put("st",mine); put("m2026-10",[]); }
if(sc==="twodev"){ put("st",mine); put("m2026-10",[{id:"a",sid:"s1",type:"lesson",date:"2026-10-01"},{id:"b",sid:"s1",type:"lesson",date:"2026-10-02",comment:""}]); }
const ev=(id,sid,date,o)=>({id,sid,date,type:"lesson",planned:true,time:"16:00",hours:1,price:1500,...o});
if(sc==="wiped"){ // список учеников в облаке затёрт, занятия целы
  put("st",[]); put("m2026-10",[ev("e1","s1","2026-10-01"),ev("e2","s2","2026-10-02",{time:"18:30",price:2000}),ev("e3","s2","2026-09-25",{time:"18:30",price:2000})]);
  store["tutor-ledger-v1"]=JSON.stringify({students:mine,months:{}}); }
if(sc==="nullread"){ put("st",mine); put("m2026-10",[ev("e1","s1","2026-10-01")]); }
const dstr=d=>d.getFullYear()+"-"+String(d.getMonth()+1).padStart(2,"0")+"-"+String(d.getDate()).padStart(2,"0");
const dayAgo=n=>{ const d=new Date(); d.setDate(d.getDate()-n); return dstr(d); };
if(sc==="torn"){ put("st",mine); put("m2026-10",[ev("e1","s1","2026-10-01")]); }
if(sc==="snap"){ put("st",mine); put("m2026-10",[ev("e1","s1","2026-10-01")]);
  for(let i=1;i<=12;i++){ put("bk"+dayAgo(i),{app:"tutor-ledger",students:[{id:"s1",name:"Арина-"+i}],months:{}}); } }
const html=fs.readFileSync(require("path").join(__dirname,"index.html"),"utf8");
const code=html.slice(html.indexOf("<script>\n(function()")+8,html.lastIndexOf("</script>"));
const mod={exports:{}}; vm.runInThisContext("(function(module){"+code+"})")(mod);
const T=mod.exports._t;
const ok=(c,m)=>{console.log((c?"  ✓ ":"  ✗ ")+m); if(!c) process.exitCode=1;};
setTimeout(async()=>{
  const names=T.students().map(s=>s.name).join(",");
  if(sc==="new"){ ok(names==="","новичок не видит чужих учеников ("+names+")"); ok(/Добавить первого ученика/.test(els.view.innerHTML),"показан мастер первого запуска"); ok(writes===0,"в облако ничего не записано"); }
  if(sc==="fail"){ ok(writes===0,"при сбое чтения облако не перезаписано (записей: "+writes+")"); ok(/Не удалось загрузить записи|Telegram не отдал/.test(els.syncState.textContent),"пользователь видит предупреждение"); }
  if(sc==="retry"){ ok(names==="Арина","разовый сбой: повторная попытка загрузила данные"); ok(writes===0,"и ничего не перезаписала"); }
  if(sc==="migrate"){ ok(!!rd("st")&&/Арина/.test(rd("st")),"локальные записи перенесены в пустое облако"); ok(!!rd("m2026-10"),"месяц перенесён"); }
  if(sc==="refresh"){
    ok(names==="Арина","загружено из облака");
    put("m2026-10",[{id:"e9",type:"lesson",sid:"s1",date:"2026-10-02"}]); // отметили на телефоне
    els.back.classList.contains=()=>false;
    await actCb(); await new Promise(r=>setTimeout(r,50));
    ok((T.months()["2026-10"]||[]).some(e=>e.id==="e9"),"после возврата в приложение видна отметка с другого устройства");
    // модалка
    T.change; 
  }
  if(sc==="twodev"){
    // на телефоне за это время: добавили c и подписали b
    put("m2026-10",[{id:"a",sid:"s1",type:"lesson",date:"2026-10-01"},{id:"b",sid:"s1",type:"lesson",date:"2026-10-02",comment:"дроби"},{id:"c",sid:"s1",type:"lesson",date:"2026-10-03"}]);
    // здесь, со старой картиной: удалили a и добавили оплату d
    T.change(()=>{ T.del("a"); T.add({id:"d",sid:"s1",type:"payment",date:"2026-10-04",amount:1000}); });
    await new Promise(r=>setTimeout(r,200));
    const cl=JSON.parse(rd("m2026-10")).map(e=>e.id).sort().join(",");
    ok(cl==="b,c,d","в облаке и отметка с телефона, и оплата отсюда, удалённое не вернулось ("+cl+")");
    ok(JSON.parse(rd("m2026-10")).find(e=>e.id==="b").comment==="дроби","подпись с телефона не затёрта");
    ok((T.months()["2026-10"]||[]).some(e=>e.id==="c"),"на этом устройстве появилась отметка с телефона");
  }
  if(sc==="wiped"){
    const st=T.students(), ar=st.find(x=>x.id==="s1"), ph=st.find(x=>x.id==="s2");
    ok(ar&&ar.name==="Арина","ученик с этого устройства вернулся с именем");
    ok(ph&&/восстановлен/.test(ph.name)&&ph.price===2000,"ученик без копии восстановлен по занятиям, с ценой ("+(ph&&ph.name)+")");
    ok(ph&&ph.sched[0]&&ph.sched[0].days.join()==="5"&&ph.sched[0].times[5]==="18:30","и с расписанием из занятий");
    const cl=JSON.parse(rd("st")||"[]").map(x=>x.id).sort().join();
    ok(cl==="s1,s2","восстановленные записаны обратно в Telegram ("+cl+")");
    ok(/пропали имена/.test(els.alertNotice.innerHTML),"показана подсказка, что вписать имена");
  }
  if(sc==="nullread"){
    delete cloud["st__n"]; // Telegram на миг не отдал список учеников
    els.back.classList.contains=()=>false;
    await actCb(); await new Promise(r=>setTimeout(r,80));
    ok(T.students().some(x=>x.name==="Арина"),"ученики на месте после сбоя чтения");
    ok(/Арина/.test(rd("st")||""),"список учеников в Telegram не затёрт пустым");
    delete cloud["m2026-10__n"]; // и месяц на миг не отдал
    await actCb(); await new Promise(r=>setTimeout(r,80));
    ok((T.months()["2026-10"]||[]).some(e=>e.id==="e1"),"занятия месяца на месте после сбоя чтения");
    ok(/e1/.test(rd("m2026-10")||""),"месяц в Telegram не затёрт пустым");
  }
  if(sc==="torn"){
    // приложение закрыли посреди сохранения: куски новой версии записаны, указатель — нет
    failPtr=1;
    T.change(()=>{ T.add({id:"e2",sid:"s1",type:"lesson",date:"2026-10-02"}); });
    await new Promise(r=>setTimeout(r,150));
    let parsed=null; try{ parsed=JSON.parse(rd("m2026-10")); }catch(e){}
    ok(parsed&&parsed.length===1&&parsed[0].id==="e1","в Telegram осталась прежняя целая версия, а не обрывок");
    // следующее сохранение проходит и подчищает старое
    T.change(()=>{ T.add({id:"e3",sid:"s1",type:"lesson",date:"2026-10-03"}); });
    await new Promise(r=>setTimeout(r,250));
    const ids=JSON.parse(rd("m2026-10")).map(e=>e.id).sort().join();
    ok(ids==="e1,e2,e3","со следующим сохранением записалось всё ("+ids+")");
    ok(!("m2026-10__0" in cloud),"старый формат убран после перехода на новый");
  }
  if(sc==="snap"){
    const dates=Object.keys(cloud).map(k=>(k.match(/^bk(.+)__n$/)||[])[1]).filter(Boolean).sort();
    const want=[dayAgo(3),dayAgo(2),dayAgo(1),dayAgo(0)].sort();
    ok(dates.includes(dayAgo(0)),"сделана копия за сегодня");
    let o=null; try{ o=JSON.parse(rd("bk"+dayAgo(0))); }catch(e){}
    ok(o&&o.students[0].name==="Арина"&&o.months["2026-10"].length===1,"в копии все ученики и занятия");
    ok(dates.join()===want.join(),"хранятся 3 последних дня и одна постарше ("+dates.map(d=>d.slice(5)).join(" ")+")");
    ok(!Object.keys(cloud).some(k=>k.startsWith("bk"+dayAgo(12)+"__")),"старые копии удалены вместе с кусками");
    const P=T.snapPlan, t="2026-10-20", seq=n=>Array.from({length:n},(_,i)=>{const d=new Date(2026,9,20-i);return dstr(d);}).reverse();
    ok(P(seq(4),t).length===0,"4 копии: ничего не удаляется");
    ok(P(seq(11),t).join()===seq(11).slice(1,8).join(),"копия 10-дневной давности держится до 10 дней");
  }
  if(sc==="modal"){}
},4000);
