const sc=process.argv[2];
const {els,store,listeners}=require(require("path").join(__dirname,"test-dom.js"));
const vm=require("vm"),fs=require("fs");
// поддельное облако
const cloud={}; let failReads=0, writes=0;
const CS={
  getItem:(k,cb)=>setTimeout(()=>failReads>0?(failReads--,cb("ERR")):cb(null,cloud[k]??""),1),
  getItems:(ks,cb)=>setTimeout(()=>{const m={};ks.forEach(k=>m[k]=cloud[k]??"");cb(null,m)},1),
  getKeys:cb=>setTimeout(()=>cb(null,Object.keys(cloud)),1),
  setItem:(k,v,cb)=>{writes++;cloud[k]=v;setTimeout(()=>cb(null,true),1)},
  removeItems:(ks,cb)=>{ks.forEach(k=>delete cloud[k]);cb&&cb(null,true)},
};
let backShown=null, closeConf=null, backCb=null, actCb=null;
global.window.Telegram={WebApp:{initData:"query_id=test&user=1",platform:"ios",ready(){},expand(){},isVersionAtLeast:()=>true,CloudStorage:CS,
  BackButton:{show(){backShown=true},hide(){backShown=false},onClick(f){backCb=f}},
  enableClosingConfirmation(){closeConf=true},disableClosingConfirmation(){closeConf=false},
  disableVerticalSwipes(){}, onEvent(n,f){ if(n==="activated") actCb=f; }, themeParams:{}, colorScheme:"light"}};
const put=(name,obj)=>{cloud[name+"__n"]="1";cloud[name+"__0"]=JSON.stringify(obj);};
const mine=[{id:"s1",name:"Арина",price:1500,hours:1,sched:[],archived:false}];
if(sc==="fail"){ put("st",mine); put("m2026-10",[{id:"e1",type:"lesson",sid:"s1",date:"2026-10-01"}]);
  store["tutor-ledger-v1"]=JSON.stringify({students:[{id:"old",name:"Старый",sched:[]}],months:{}}); failReads=2; }
if(sc==="retry"){ put("st",mine); failReads=1; }
if(sc==="migrate"){ store["tutor-ledger-v1"]=JSON.stringify({students:mine,months:{"2026-10":[{id:"e1",type:"lesson",sid:"s1",date:"2026-10-01"}]}}); }
if(sc==="refresh"){ put("st",mine); put("m2026-10",[]); }
if(sc==="twodev"){ put("st",mine); put("m2026-10",[{id:"a",sid:"s1",type:"lesson",date:"2026-10-01"},{id:"b",sid:"s1",type:"lesson",date:"2026-10-02",comment:""}]); }
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
  if(sc==="migrate"){ ok(!!cloud["st__0"]&&/Арина/.test(cloud["st__0"]),"локальные записи перенесены в пустое облако"); ok(!!cloud["m2026-10__0"],"месяц перенесён"); }
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
    const cl=JSON.parse(cloud["m2026-10__0"]).map(e=>e.id).sort().join(",");
    ok(cl==="b,c,d","в облаке и отметка с телефона, и оплата отсюда, удалённое не вернулось ("+cl+")");
    ok(JSON.parse(cloud["m2026-10__0"]).find(e=>e.id==="b").comment==="дроби","подпись с телефона не затёрта");
    ok((T.months()["2026-10"]||[]).some(e=>e.id==="c"),"на этом устройстве появилась отметка с телефона");
  }
  if(sc==="modal"){}
},2500);
