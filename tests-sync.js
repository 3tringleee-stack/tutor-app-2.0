// Проверка синхронизации с облаком Telegram: node tests-sync.js
const {execFileSync}=require("child_process"), path=require("path");
let bad=0;
for(const [sc,title] of [["new","Новый пользователь"],["fail","Telegram не отдал записи"],["retry","Разовый сбой связи"],["migrate","Перенос с устройства в пустое облако"],["refresh","Отметка с другого устройства"],["twodev","Два устройства одновременно"],["wiped","Список учеников пропал из облака"],["nullread","Telegram на миг не отдал список учеников"]]){
  console.log("\n"+title);
  try{ process.stdout.write(execFileSync("node",[path.join(__dirname,"sync-scenario.js"),sc],{stdio:["ignore","pipe","ignore"]}).toString()); }
  catch(e){ process.stdout.write(String(e.stdout||"")); bad++; }
}
console.log(bad?"\nЕсть ошибки: "+bad:"\nСинхронизация: все проверки пройдены");
process.exitCode=bad?1:0;
