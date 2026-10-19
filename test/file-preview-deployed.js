'use strict';
// Staging-only acceptance. Creates and removes two disposable accounts and
// their fixtures through public APIs. Never logs credentials, tokens or bodies.
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { _internals } = require('../services/officeArtifactService');
(async () => {
  const origin = new URL(process.env.FILES_SMOKE_URL).origin;
  assert.ok(['https://panthorium-backend-staging-4ixtzhfyva-as.a.run.app', 'https://panthorium-backend-staging-124818950958.asia-southeast1.run.app'].includes(origin), 'staging-only target');
  assert.ok(process.env.FILES_SMOKE_ADMIN_PASSWORD, 'staging test credential required');
  const alias=origin.includes('-4ixtzhfyva-as')?'https://panthorium-backend-staging-124818950958.asia-southeast1.run.app':'https://panthorium-backend-staging-4ixtzhfyva-as.a.run.app';
  const sessions = [], users = [], fixtures = [];
  const call = (route, token, init = {}) => fetch(origin + route, { ...init, redirect: 'error', signal: AbortSignal.timeout(30000), headers: { ...(token ? {Authorization:'Bearer ' + token} : {}), ...init.headers } });
  async function json(route, token, body, expected = 200, method = 'POST') {
    const r = await call(route, token, {method, headers:{'Content-Type':'application/json'}, body:JSON.stringify(body)});
    assert.equal(r.status, expected, method + ' ' + route);
    const data = await r.json();
    const cookie = r.headers.getSetCookie().map(c => c.split(';')[0]).join('; ');
    if (cookie) sessions.push(cookie);
    return data;
  }
  const admin = await json('/api/auth/login', null, { username:process.env.FILES_SMOKE_ADMIN_USERNAME || 'admin', password:process.env.FILES_SMOKE_ADMIN_PASSWORD });
  try {
    for (let i = 0; i < 2; i++) {
      const credentials = {username:'preview-' + crypto.randomBytes(8).toString('hex'), password:crypto.randomBytes(24).toString('base64url')};
      const result = await json('/api/auth/users', admin.accessToken, {...credentials, roles:[],permissions:['chat']}, 201);
      const user = {id:result.user.id}; users.push(user);
      user.token = (await json('/api/auth/login', null, credentials)).accessToken;
    }
    const guest = await json('/api/auth/guest', null, {});
    const owner = users[0].token;
    const cases = [
      ['preview.print.html', 'text/html', Buffer.from('<h1>Preview fixture</h1><table><tr><td>100</td></tr></table>')],
      ['preview.xlsx', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', _internals.spreadsheetBuffer({title:'Preview',sheets:[{name:'Data',rows:[['Value'],[100]]}]})],
      ['preview.docx','application/vnd.openxmlformats-officedocument.wordprocessingml.document',_internals.documentBuffer({title:'Preview',sections:[{paragraphs:['Original text']}]},[])],
      ['preview.pptx','application/vnd.openxmlformats-officedocument.presentationml.presentation',_internals.presentationBuffer({title:'Preview',slides:[{title:'Original title',bullets:['Original bullet']}]},[])],
      ['preview.png', 'image/png', Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a2e8AAAAASUVORK5CYII=', 'base64')]
    ];
    for (const [name, type, body] of cases) {
      const upload = await call('/api/files', owner, {method:'POST',headers:{'Content-Type':'application/octet-stream','X-File-Name':encodeURIComponent(name),'X-File-Content-Type':type},body});
      assert.equal(upload.status,201,'fixture upload');
      const {file} = await upload.json(); fixtures.push(file.id);
      const preview = await call('/api/files/' + file.id + '/preview', owner);
      assert.equal(preview.status,200,'owned preview');
      assert.equal(preview.headers.get('cache-control'),'private, no-store');
      const bytes = Buffer.from(await preview.arrayBuffer());
      if (/\.(xlsx|docx|pptx)$/.test(name)) { assert.equal(preview.headers.get('x-panthorium-preview'),'office-text'); assert.match(bytes.toString(),/100|Original/); }
      else assert.ok(bytes.equals(body), 'stored fixture is readable');
      assert.equal((await call('/api/files/' + file.id + '/preview', users[1].token)).status,404,'other account denied');
      assert.equal((await call('/api/files/' + file.id + '/preview', guest.accessToken)).status,403,'guest denied');
      if (/\.(xlsx|docx|pptx|png)$/.test(name)) {
        const editorResponse=await call('/api/studio/editor/'+file.id,owner);assert.equal(editorResponse.status,200,'editor owned read');
        const edit=await editorResponse.json();
        assert.equal((await call('/api/studio/editor/'+file.id,users[1].token)).status,404,'editor isolation');
        assert.equal((await call('/api/studio/editor/'+file.id,guest.accessToken)).status,403,'editor guest denial');
        const operations=edit.pluginId==='spreadsheet'?[{type:'set_cell',sheet:0,cell:'A2',value:500},{type:'set_formula',sheet:0,cell:'B2',value:'=SUM(A2:A2)*2'},{type:'format_cell',sheet:0,cell:'B2',style:{bold:true,numberFormat:'decimal'}}]:edit.pluginId==='image'?[{type:'rotate',degrees:90}]:[{type:'set_text',index:0,value:'Edited text'},{type:'format_text',index:0,style:{bold:true,fontSize:32,color:'AA5500'}},...(edit.pluginId==='presentation'?[{type:'move_text',index:0,x:10,y:10,width:80,height:20},{type:'slide_background',page:1,color:'FFF4E8'},{type:'add_slide',value:'New native slide'}]:[{type:'insert_table',rows:[['Name','Value'],['A','100']]}])];
        if(edit.pluginId!=='image'){
          const path='/api/studio/editor/'+file.id+'/draft';assert.equal((await (await call(path,owner)).json()).version,0);
          const draftBody={version:0,revision:edit.revision,operations,name:'Staging draft'};
          assert.equal((await json(path,owner,draftBody,200,'PUT')).version,1);
          await json(path,owner,draftBody,409,'PUT');assert.equal((await call(path,users[1].token)).status,404);assert.equal((await call(path,guest.accessToken)).status,403);
          await json(path,owner,{...draftBody,version:1,operations:[]},200,'PUT');
        }
        const request={pluginId:edit.pluginId,sourceFileIds:[file.id],input:{prompt:'Staging editor acceptance',edit:{fileId:file.id,revision:edit.revision,operations}},confirmed:true,idempotencyKey:'acceptance:'+crypto.randomUUID()};
        const saved=await json('/api/studio/jobs',owner,request);assert.equal(saved.job.status,'completed','real editor save');
        for(const output of saved.job.files)fixtures.push(output.id);
        const replay=await json('/api/studio/jobs',owner,request);assert.equal(replay.job.id,saved.job.id,'no duplicate save');
        const read=await call('/api/studio/editor/'+saved.job.files[0].id,owner);assert.equal(read.status,200);const copy=await read.json();
        const aliasResponse=await fetch(alias+'/api/studio/editor/'+saved.job.files[0].id,{headers:{Authorization:'Bearer '+owner},redirect:'error',signal:AbortSignal.timeout(30000)});assert.equal(aliasResponse.status,200,'second staging alias opens the saved Office file');assert.deepEqual(await aliasResponse.json(),copy,'both aliases return the same saved revision and content');
        if(copy.sheets){assert.equal(copy.sheets[0].cells.find(c=>c.cell==='A2').value,500);const formula=copy.sheets[0].cells.find(c=>c.cell==='B2');assert.equal(formula.value,1000);assert.equal(formula.calculated,1000);assert.equal(formula.style.bold,true);}
        if(copy.blocks){assert.equal(copy.blocks[0].text,'Edited text');assert.equal(copy.blocks[0].style.fontSize,32);assert.equal(copy.blocks[0].style.bold,true);if(copy.pluginId==='presentation'){assert.equal(copy.pageCount,2);assert.equal(copy.blocks[0].geometry.x,10);assert.equal(copy.backgrounds[0],'FFF4E8');}}
        assert.equal((await (await call('/api/studio/editor/'+file.id,owner)).json()).revision,edit.revision,'original unchanged');
      }
      const download = await call('/api/files/' + file.id, owner);
      assert.equal(download.status,402,'Free export quota remains enforced');
      assert.equal((await download.json()).error,'quota_exceeded:downloadBytes');
    }
    console.log('PASS both staging aliases: Office suite, versioned drafts and real-bucket preview: Free account preview and DOCX/XLSX/PPTX/image editing round trips, account isolation, Guest denial and export quota');
  } finally {
    let failed = false;
    for (const id of fixtures) { const r = await call('/api/files/' + id, users[0].token, {method:'DELETE'}); if (!r.ok) failed = true; }
    for (const user of users) { const r = await call('/api/auth/users/' + user.id, admin.accessToken, {method:'DELETE'}); if (!r.ok) failed = true; }
    for (const cookie of sessions) { const r = await call('/api/auth/logout', null, {method:'POST',headers:{Cookie:cookie}}); if (!r.ok) failed = true; }
    assert.equal(failed,false,'staging fixture/session cleanup');
  }
})().catch(error => { console.error(error.message); process.exitCode = 1; });
