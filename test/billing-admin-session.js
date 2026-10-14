'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs');
const {JSDOM}=require('jsdom');
const tick=()=>new Promise(r=>setTimeout(r,25));
async function scenario(mode){
 const dom=new JSDOM('<div id="sm-apps"></div>',{url:'https://panthorium.test/admin',runScripts:'outside-only'}),w=dom.window;
 let refreshes=0;const puts=[];
 w.OS={state:{user:{id:'admin-owner'}},config:{backendUrl:'https://panthorium.test',accessToken:'expired-fixture'},windows:new Map()};
 w.PanthoriumAuth={isAdministrator:()=>true,refreshSession:async()=>{refreshes++;if(mode==='failed')return false;if(mode==='changed')w.OS.state.user={id:'another-admin'};w.OS.config.accessToken='fresh-fixture';return true;}};
 w.createWindow=(id,title,html)=>{const e=w.document.createElement('section');e.className='window';e.dataset.id=id;e.innerHTML=html;w.document.body.append(e);w.OS.windows.set(id,e);};
 const profile={name:'Test Operator',brand:'Panthorium',address:'Test business address',taxId:'0000000000000',email:'account@example.test'};
 w.fetch=async(url,opts)=>{if(opts.method==='PUT'){puts.push({headers:opts.headers,body:opts.body});return puts.length===1||mode==='persistent'?Response.json({error:'invalid_or_expired_token'},{status:401}):Response.json({ok:true});}return Response.json({ok:true,report:{totals:{},rows:[],profile,completeIdentity:true},orders:[],grants:[],gateway:{mode:'live',connected:false,checkoutEnabled:false}});};
 w.eval(fs.readFileSync(require.resolve('../billing-admin-ui.js'),'utf8'));w.PanthoriumBillingAdmin.open();await tick();[...w.document.querySelectorAll('nav button')].find(e=>e.textContent==='ข้อมูลผู้ประกอบการ').click();const form=w.document.querySelector('form');form.elements.address.value='Preserve this input';form.dispatchEvent(new w.Event('submit',{cancelable:true}));await tick();await tick();
 assert.equal(refreshes,1,'exactly one refresh attempt');
 if(mode==='success'){assert.equal(puts.length,2);assert.equal(puts[0].body,puts[1].body,'replay identical payload only');assert.equal(puts[1].headers.Authorization,'Bearer fresh-fixture');assert.match(w.document.querySelector('[role=status]').textContent,/บันทึกข้อมูลผู้ประกอบการเรียบร้อยแล้ว/);}
 else{assert.equal(puts.length,mode==='persistent'?2:1);assert.equal(form.elements.address.value,'Preserve this input');assert.match(w.document.querySelector('[role=status]').textContent,mode==='changed'?/บัญชีเข้าสู่ระบบเปลี่ยนแล้ว/:/เซสชันหมดอายุ/);}
 w.close();
}
(async()=>{for(const mode of ['success','failed','changed','persistent'])await scenario(mode);console.log('PASS finance session: expired JWT renewal, identical replay, saved confirmation, failed refresh preserves form, account switch blocks replay and bounded retries');})().catch(e=>{console.error(e);process.exitCode=1;});
