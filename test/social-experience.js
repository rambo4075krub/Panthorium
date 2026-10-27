"use strict";
const assert = require("node:assert/strict"), { randomUUID } = require("node:crypto"), { execFileSync } = require("node:child_process");
const { SocialRepository } = require("../services/socialRepository"), { SocialService } = require("../services/socialService");
async function suite(repo) {
  await repo.init();
  const [a,b,c] = Array.from({length:3},() => ({sub:randomUUID(),roles:["user"],permissions:["chat"]}));
  const file={id:randomUUID(),name:"clip.webm",contentType:"video/webm"}; let bytes=require("./social-video-fixture")();
  const service=new SocialService({repository:repo,files:{ findObject:async(uid,id)=>{ assert.equal(uid,a.sub);assert.equal(id,file.id);return file; },preview:async()=>({body:bytes,contentType:file.contentType}) }});
  const write=(u,action,input={})=>service.write({user:u,action,input,requestId:randomUUID()});
  for(const [i,u] of [a,b,c].entries()) await write(u,"profile",{name:"Person "+i,discoverable:true});
  await write(b,"follow",{userId:a.sub});
  const request=(await write(c,"friend-request",{userId:a.sub})).record;await write(a,"friend-review",{recordId:request.id,accept:true});
  const post=(await write(a,"publish",{module:"feed",text:"Searchable photo caption"})).record;
  for(const u of [b,c]) { const n=await service.notifications.list(u.sub,undefined,"feed");assert(n.items.some(n=>n.type==="new-post"&&n.target.recordId===post.id));assert.equal(n.counts.feed,1); }
  const own=(await service.read({user:a,module:"profile",query:"Searchable"})).items;assert.equal(own.length,1);assert.equal(own[0].id,post.id);assert.equal((await service.read({user:b,module:"profile"})).items.length,0);
  await write(b,"like",{recordId:post.id,enabled:true});await write(b,"like",{recordId:post.id,enabled:true});assert.equal((await repo.get(post.id)).likeCount,1);
  await write(b,"comment",{recordId:post.id,text:"hello"});await write(b,"share",{recordId:post.id});
  let notices=await service.notifications.list(a.sub,undefined,"notifications");assert.deepEqual(notices.items.filter(n=>n.target?.recordId===post.id).map(n=>n.type).sort(),["comment","like","share"]);assert.equal(notices.counts.feed||0,0);assert(notices.items.every(n=>n.target.module==="feed"));
  const through=new Date().toISOString();await service.notifications.readSection(a.sub,{module:"notifications",through});assert.equal((await service.notifications.list(a.sub)).counts.notifications||0,0);
  await service.notifications.readSection(b.sub,{module:"feed",recordIds:[post.id],through:new Date().toISOString()});assert.equal((await service.notifications.list(b.sub)).counts.feed||0,0);assert.equal((await service.notifications.list(c.sub)).counts.feed,1);
  const group=(await write(a,"group-create",{title:"Community",text:"A searchable description",privacy:"open"})).record;await write(b,"group-join",{recordId:group.id});
  const msg=(await write(a,"group-message",{recordId:group.id,text:"group unread"})).record;
  assert.equal((await service.notifications.list(b.sub)).recordCounts[group.id],1);
  await service.notifications.readSection(b.sub,{module:"community",recordIds:[group.id],through:new Date().toISOString()});assert.equal((await service.notifications.list(b.sub)).recordCounts[group.id],1,"opening alone does not read unseen chat messages");
  await service.markRead({user:b,recordId:group.id,messageIds:[msg.id]});assert.equal((await service.notifications.list(b.sub)).recordCounts[group.id]||0,0);
  assert.equal((await service.collections({user:b,kind:"group",query:"searchable"})).items[0].text,"A searchable description");
  const clip=(await write(a,"publish",{module:"short",fileIds:[file.id]})).record;assert(clip.files[0].durationSeconds<=60);
  bytes=execFileSync("ffmpeg",["-v","error","-f","lavfi","-i","color=c=blue:size=32x32:rate=1:duration=62","-c:v","libvpx","-f","webm","pipe:1"]);
  await assert.rejects(()=>write(a,"publish",{module:"short",fileIds:[file.id]}),/social_short_duration/);
  bytes=Buffer.from("not a video");await assert.rejects(()=>write(a,"publish",{module:"short",fileIds:[file.id]}),/social_short_duration/);
  await write(a,"edit",{recordId:post.id,audience:"private"});assert(!(await service.notifications.list(c.sub)).items.some(n=>n.target?.recordId===post.id));await assert.rejects(()=>write(c,"share",{recordId:post.id}),/social_not_found/);
  console.log("Social experience: new-post vs interaction routing, target ACL, per-record unread/visible receipts, own-post search, 60-second media probing, share and idempotent double-tap like passed");
}
if(require.main===module)suite(new SocialRepository({allowMemory:true})).catch(e=>{console.error(e);process.exitCode=1;});module.exports={suite};
