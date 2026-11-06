'use strict';
const {Parser}=require('htmlparser2');
function parse(xml,handlers){const p=new Parser(handlers,{xmlMode:true,decodeEntities:true});p.end(xml);}
function sharedStrings(xml){const out=[];let active=false,text='';parse(xml,{onopentag(n){if(n==='si'){active=true;text='';}},ontext(t){if(active)text+=t;},onclosetag(n){if(n==='si'){out.push(text);active=false;}}});return out;}
function sheetText(xml,shared){let cell=null,tag='',value='',formula='',inline='',out=[];parse(xml,{onopentag(n,a){tag=n;if(n==='c'){cell=a;value='';formula='';inline='';}},ontext(t){if(!cell)return;if(tag==='v')value+=t;if(tag==='f')formula+=t;if(tag==='t')inline+=t;},onclosetag(n){if(n==='c'&&cell){const actual=cell.t==='s'?shared[Number(value)]:cell.t==='inlineStr'?inline:value;out.push(`${cell.r||'?'}: ${actual??'[missing shared string]'}${formula?' (cached formula result; formula '+formula+')':''}`);cell=null;}tag='';}});return out.join('\n');}
module.exports={sharedStrings,sheetText};
