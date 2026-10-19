/* Panthorium formula interpreter. Original implementation; no eval or remote code. */
(function(root,factory){'use strict';const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.PanthoriumOfficeCore=api;})(typeof window==='object'?window:globalThis,function(){
  'use strict';
  const supported=['SUM','AVERAGE','MIN','MAX','COUNT','COUNTA','IF','AND','OR','NOT','ROUND','ABS'];
  const error=code=>{throw Error(code);};
  function parse(source){
    if(typeof source!=='string'||source.length>2000)error('#LIMIT!');
    source=source.replace(/^=/,'');let at=0,steps=0;
    const tokens=[];const re=/\s+|(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?|"(?:[^"]|"")*"|'(?:[^']|'')*'|\$?[A-Za-z_][A-Za-z_0-9.$]*|<>|<=|>=|[+\-*/^%(),:!=<>]/gy;
    while(at<source.length){re.lastIndex=at;const m=re.exec(source);if(!m)error('#NAME?');at=re.lastIndex;if(!/^\s/.test(m[0]))tokens.push(m[0]);if(tokens.length>512)error('#LIMIT!');}
    let i=0;const peek=()=>tokens[i],take=()=>tokens[i++],expect=t=>{if(take()!==t)error('#VALUE!');};
    const prec={'=':1,'<>':1,'<':1,'>':1,'<=':1,'>=':1,'+':2,'-':2,'*':3,'/':3,'^':4};
    function expr(min=0,depth=0){
      if(depth>48||++steps>1024)error('#LIMIT!');let t=take(),node;
      if(t==='+'||t==='-')node={op:'unary'+t,args:[expr(4,depth+1)]};
      else if(t==='('){node=expr(0,depth+1);expect(')');}
      else if(t&&/^\d|^\.\d/.test(t))node={value:Number(t)};
      else if(t?.startsWith('"'))node={value:t.slice(1,-1).replace(/""/g,'"')};
      else if(t&&peek()==='('){
        const name=t.toUpperCase();if(!supported.includes(name))error('#NAME?');take();const args=[];
        if(peek()!==')')do{args.push(expr(0,depth+1));if(peek()!==',')break;take();}while(true);
        expect(')');node={op:name,args};
      }else if(t){
        let sheet=null;if(peek()==='!'){take();sheet=t.startsWith("'")?t.slice(1,-1).replace(/''/g,"'"):t;t=take();}
        const ref=t?.replace(/\$/g,'').toUpperCase();
        if(sheet===null&&['TRUE','FALSE'].includes(ref))node={value:ref==='TRUE'};
        else{if(!/^[A-Z]{1,3}[1-9]\d{0,6}$/.test(ref||''))error('#NAME?');node={ref,sheet};if(peek()===':'){take();const end=take()?.replace(/\$/g,'').toUpperCase();if(!/^[A-Z]{1,3}[1-9]\d{0,6}$/.test(end||''))error('#REF!');node.end=end;}}
      }else error('#VALUE!');
      while(peek()==='%'){take();node={op:'%',args:[node]};}
      while(Object.hasOwn(prec,peek())&&prec[peek()]>=min){const op=take();node={op,args:[node,expr(prec[op]+(op==='^'?0:1),depth+1)]};}
      return node;
    }
    const ast=expr();if(i!==tokens.length)error('#VALUE!');return ast;
  }
  const coord=ref=>[Array.from(ref.match(/^[A-Z]+/)[0]).reduce((n,c)=>n*26+c.charCodeAt(0)-64,0),Number(ref.match(/\d+/)[0])];
  function column(n){let s='';for(;n;n=Math.floor((n-1)/26))s=String.fromCharCode(65+(n-1)%26)+s;return s;}
  function calculate(sheets){
    const maps=sheets.map(s=>new Map(s.cells.map(c=>[c.cell,c]))),cache=new Map(),active=new Set();let budget=100000;
    const scalar=v=>{if(Array.isArray(v))error('#VALUE!');return v;};
    const num=v=>{v=scalar(v);if(v===''||v==null)return 0;if(typeof v==='boolean')return +v;if(typeof v!=='number'||!Number.isFinite(v))error('#VALUE!');return v;};
    function cell(si,ref,depth=0){
      if(depth>64||--budget<0)error('#LIMIT!');const key=si+':'+ref;if(cache.has(key)){const v=cache.get(key);if(v.error)error(v.error);return v.value;}
      if(active.has(key))error('#CYCLE!');const c=maps[si]?.get(ref);if(!c)return '';
      if(!c.formula)return c.value;
      if(!c.formulaText)error('#UNSUPPORTED!');
      active.add(key);try{const value=evalNode(parse(c.formulaText),si,depth+1);if(typeof value==='number'&&!Number.isFinite(value))error('#NUM!');cache.set(key,{value});return value;}catch(e){cache.set(key,{error:e.message});throw e;}finally{active.delete(key);}
    }
    function evalNode(n,si,depth){
      if(--budget<0||depth>64)error('#LIMIT!');if(Object.hasOwn(n,'value'))return n.value;
      if(n.ref){const target=n.sheet===null?si:sheets.findIndex(s=>s.name.toLowerCase()===n.sheet.toLowerCase());if(target<0)error('#REF!');if(!n.end)return cell(target,n.ref,depth+1);
        const [x,y]=coord(n.ref),[xx,yy]=coord(n.end);if((Math.abs(x-xx)+1)*(Math.abs(y-yy)+1)>10000)error('#LIMIT!');const values=[];
        for(let r=Math.min(y,yy);r<=Math.max(y,yy);r++)for(let c=Math.min(x,xx);c<=Math.max(x,xx);c++)values.push(cell(target,column(c)+r,depth+1));return values;
      }
      if(n.op==='IF'){if(n.args.length<2||n.args.length>3)error('#VALUE!');return scalar(evalNode(n.args[0],si,depth+1))?evalNode(n.args[1],si,depth+1):n.args[2]?evalNode(n.args[2],si,depth+1):false;}
      const args=n.args.map(a=>evalNode(a,si,depth+1)),flat=args.flat(),numbers=flat.filter(v=>typeof v==='number');
      if(['SUM','AVERAGE','MIN','MAX','COUNT','COUNTA','AND','OR'].includes(n.op)){
        if(!args.length)error('#VALUE!');if(n.op==='SUM')return numbers.reduce((a,b)=>a+b,0);if(n.op==='COUNT')return numbers.length;if(n.op==='COUNTA')return flat.filter(v=>v!==''&&v!=null).length;
        if(n.op==='AND')return flat.every(Boolean);if(n.op==='OR')return flat.some(Boolean);if(n.op==='AVERAGE'){if(!numbers.length)error('#DIV/0!');return numbers.reduce((a,b)=>a+b,0)/numbers.length;}
        return numbers.length?numbers.reduce((a,b)=>n.op==='MIN'?Math.min(a,b):Math.max(a,b)):0;
      }
      if(['ROUND'].includes(n.op)){if(args.length!==2)error('#VALUE!');const places=num(args[1]);if(!Number.isInteger(places)||Math.abs(places)>12)error('#NUM!');const v=num(args[0]),p=10**places;return Math.sign(v)*Math.round((Math.abs(v)+Number.EPSILON)*p)/p;}
      if(['ABS','NOT','unary+','unary-','%'].includes(n.op)){if(args.length!==1)error('#VALUE!');if(n.op==='NOT')return !scalar(args[0]);const v=num(args[0]);return n.op==='ABS'?Math.abs(v):n.op==='unary-'?-v:n.op==='%'?v/100:v;}
      const [a,b]=args.map(scalar);if(['=','<>','<','>','<=','>='].includes(n.op)){const l=typeof a==='string'?a.toLowerCase():a,r=typeof b==='string'?b.toLowerCase():b;return ({'=':()=>l===r,'<>':()=>l!==r,'<':()=>l<r,'>':()=>l>r,'<=':()=>l<=r,'>=':()=>l>=r})[n.op]();}
      const x=num(a),y=num(b);if(n.op==='/'&&y===0)error('#DIV/0!');return ({'+':()=>x+y,'-':()=>x-y,'*':()=>x*y,'/':()=>x/y,'^':()=>x**y})[n.op]();
    }
    return sheets.map((s,si)=>({...s,cells:s.cells.map(c=>{if(!c.formula)return {...c};try{return {...c,calculated:cell(si,c.cell)};}catch(e){return {...c,calculated:e.message,calculationError:true};}})}));
  }
  return Object.freeze({parse,calculate,column,supported});
});
