global.setInterval=()=>0;
const els={};
const listeners={};
function mk(id){ return {id,textContent:"",innerHTML:"",hidden:false,value:"",checked:false,files:[],dataset:{},style:{setProperty(){}},classList:{add(){},remove(){},toggle(){},contains(){return true}},addEventListener(){},click(){},querySelectorAll(){return[]},querySelector(){return null},setAttribute(){},focus(){}}; }
function el(id){ return els[id]||(els[id]=mk(id)); }
global.document={getElementById:el,addEventListener:(t,f)=>listeners[t]=f,querySelectorAll:()=>[],documentElement:{dataset:{},style:{setProperty(){}}},createElement:()=>mk("x"),body:{appendChild(){},classList:{toggle(){},add(){},remove(){}},style:{}},title:""};
const store={};
global.localStorage={getItem:k=>store[k]??null,setItem:(k,v)=>store[k]=v};
global.matchMedia=()=>({matches:false,addEventListener(){}});
global.requestAnimationFrame=f=>f&&0;
global.window={};
global.Blob=function(){}; global.URL={createObjectURL:()=>"",revokeObjectURL(){}};
module.exports={els,listeners,store};
