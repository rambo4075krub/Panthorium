'use strict';
const assert=require('node:assert/strict');
const core=require('../office-suite-core');
const rows=[['ไทย',10,2],['Thai',20,3],['ไทย',30,4],['a*b',40,5],['A?B',50,6],['',60,7]];
const cells=rows.flatMap((row,r)=>row.map((value,c)=>({cell:core.column(c+1)+(r+1),value})));
function result(formula,input=cells){return core.calculate([{name:'Data',cells:[...input,{cell:'Z99',formula:true,formulaText:formula}]}])[0].cells.at(-1);}
function check(formula,want,input){assert.equal(result(formula,input).calculated,want,formula);}
for(const [formula,want]of [
  ['=COUNTIF(A1,"ไทย")',1],['=SUMIF(A1,"ไทย",B1)',10],['=INDEX(B1,1,1)',10],['=COUNTIF(A1:A6,"ไทย")',2],['=SUMIF(A1:A6,"ไทย",B1:B6)',40],['=AVERAGEIF(A1:A6,"ไทย",B1:B6)',20],
  ['=SUMIF(B1:B6,">=30")',180],['=COUNTIF(A1:A6,"THAI")',1],['=COUNTIF(B1:B6,20)',1],
  ['=SUMIFS(B1:B6,A1:A6,"ไทย",C1:C6,">2")',30],['=COUNTIFS(B1:B6,">=20",C1:C6,"<5")',2],
  ['=AVERAGEIFS(B1:B6,C1:C6,">=4",C1:C6,"<=5")',35],
  ['=COUNTIF(A1:A6,"a*b")',2],['=COUNTIF(A1:A6,"a~*b")',1],['=COUNTIF(A1:A6,"a~?b")',1],['=COUNTIF(A1:A6,"")',1],['=COUNTIF(A1:A6,"<>ไทย")',4],
  ['=SUMPRODUCT(B1:B6,C1:C6)',1120],['=INDEX(A1:C6,3,2)',30],['=MATCH("THAI",A1:A6,0)',2],['=VLOOKUP("ไทย",A1:C6,2,FALSE)',10],
  ['=IFERROR(1/0,25)',25],['=IFERROR(5,1/0)',5],['=IFERROR(MATCH("missing",A1:A6,0),"not found")','not found'],
  ['=AVERAGEIF(A1:A6,"missing",B1:B6)','#DIV/0!'],['=INDEX(A1:C6,7,2)','#REF!'],['=MATCH("missing",A1:A6,0)','#N/A'],
  ['=VLOOKUP("ไทย",A1:C6,4,FALSE)','#REF!'],['=VLOOKUP("ไทย",A1:C6,2,TRUE)','#UNSUPPORTED!'],['=MATCH(10,B1:B6,1)','#UNSUPPORTED!'],
  ['=SUMIFS(B1:B6,A1:A5,"ไทย")','#VALUE!'],['=COUNTIFS(A1:A6)','#VALUE!'],['=SUMIF(A1:A6,"ไทย",A1:C2)','#VALUE!'],
  ['=SUMPRODUCT(B1:B6,C1:C5)','#VALUE!'],['=COUNTIF(A1:Z9999,"x")','#LIMIT!'],
  ['=IFERROR(SUM(A1:Z9999),0)','#LIMIT!']
])check(formula,want);
check('=IFERROR(A1,0)','#CYCLE!',[{cell:'A1',formula:true,formulaText:'=Z99'}]);
check('=COUNTIF(A1:A1,"*a*a*a*a*a*a*a*a*a*a*b")','#LIMIT!',[{cell:'A1',value:'a'.repeat(120000)}]);
const cross=core.calculate([{name:'Thai Data',cells},{name:'Report',cells:[{cell:'A1',formula:true,formulaText:'=SUMIF(\'Thai Data\'!A1:A6,"ไทย",\'Thai Data\'!B1:B6)'}]}]);
assert.equal(cross[1].cells[0].calculated,40);
for(const source of ['=WEBSERVICE("x")','=XLOOKUP(1,A1:A2,B1:B2)','=SUMIF(A1:A6,"x");process.exit()'])assert.throws(()=>core.parse(source));
console.log('PASS advanced Office formulas: conditional aggregates, bounded wildcard criteria, SUMPRODUCT, exact lookup, INDEX, lazy IFERROR, shape/error/cycle/limit checks');
