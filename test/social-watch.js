"use strict";
const assert=require("node:assert/strict"),{randomUUID}=require("node:crypto");
const {SocialRepository}=require("../services/socialRepository"),{SocialService}=require("../services/socialService");
async function suite(repo){
 await repo.init();const [owner,friend,other]=Array.from({length:3},()=>({sub:randomUUID(),roles:["user"],permissions:["chat"]}));
 const gif={id:randomUUID(),name:"animation.gif",size:90,contentType:"image/gif"};
 const video={id:randomUUID(),name:"clip.webm",size:150,contentType:"video/webm"};
 const service=new SocialService({repository:repo,files:{findObject:async(uid,id)=>{assert.equal(uid,owner.sub);return id===video.id?video:gif;},preview:async()=>({body:Buffer.from("GIF89a"),contentType:"image/gif"})}});
 const write=(user,action,input)=>service.write({user,action,input,requestId:randomUUID()});
 for(const [i,user] of [owner,friend,other].entries())await write(user,"profile",{name:["Owner","Friend","Other"][i],discoverable:true});
 const post=(await write(owner,"publish",{module:"watch",text:"Friends only",audience:"friends",fileIds:[gif.id]})).record;
 assert.equal(post.title,""); assert.equal((await service.read({user:owner,recordId:post.id})).record.commentCount,0);
 const deny=async(user)=>{
  assert(!(await service.read({user,module:"watch"})).items.some(p=>p.id===post.id));
  await assert.rejects(()=>service.read({user,recordId:post.id}),/social_not_found/);
  await assert.rejects(()=>service.media({user,recordId:post.id,fileId:gif.id}),/social_not_found/);
  await assert.rejects(()=>write(user,"comment",{recordId:post.id,text:"outside"}),/social_not_found/);
 };
 await deny(friend);await write(friend,"follow",{userId:owner.sub});await deny(friend);
 const request=(await write(friend,"friend-request",{userId:owner.sub})).record;await deny(friend);
 await write(owner,"friend-review",{recordId:request.id,accept:true});
 assert((await service.read({user:friend,module:"watch"})).items.some(p=>p.id===post.id));
 assert.equal((await service.media({user:friend,recordId:post.id,fileId:gif.id})).contentType,"image/gif");
 const first=(await write(friend,"comment",{recordId:post.id,text:"Comment <script>safe</script>"})).record;
 assert.equal((await service.read({user:owner,recordId:post.id})).record.commentCount,1);
 await assert.rejects(()=>write(owner,"delete",{recordId:first.id}),/social_not_found/);
 await assert.rejects(()=>write(other,"delete",{recordId:first.id}),/social_not_found/);
 await write(friend,"delete",{recordId:first.id});
 assert.equal((await service.read({user:owner,recordId:post.id})).record.commentCount,0);
 const surviving=(await write(friend,"comment",{recordId:post.id,text:"Surviving comment"})).record;
 await write(friend,"friend-remove",{recordId:request.id});await deny(friend);
 await assert.rejects(()=>service.read({user:friend,recordId:surviving.id}),/social_not_found/);
 await write(owner,"edit",{recordId:post.id,audience:"public"});
 assert.equal((await service.read({user:other,recordId:post.id})).record.commentCount,1);
 const legacy={...post,id:"legacy:"+randomUUID(),kind:"community",audience:"public"};await repo.put(legacy);
 assert.equal((await service.read({user:other,recordId:legacy.id})).record.module,"watch");
 // Accurate count across pages, moderation, deletion and per-viewer blocks.
 for(let i=0;i<205;i++)await repo.put({...surviving,id:String(Date.now()+i).padStart(16,"0")+"-"+randomUUID(),parentId:legacy.id,ownerId:i<100?friend.sub:other.sub,text:"Comment "+i});
 let page=await service.read({user:owner,recordId:legacy.id});assert.equal(page.items.length,100);assert.equal(page.record.commentCount,205);assert(page.nextCursor);
 await write(owner,"block",{userId:friend.sub});page=await service.read({user:owner,recordId:legacy.id});assert.equal(page.record.commentCount,105);
 await write(owner,"block",{userId:friend.sub,enabled:false});
 const hidden=page.items.find(r=>r.ownerId===other.sub);await repo.put({...await repo.get(hidden.id),hidden:true});
 assert.equal((await service.read({user:owner,recordId:legacy.id})).record.commentCount,204);
 await write(other,"block",{userId:owner.sub});
 assert.equal((await service.read({user:owner,recordId:legacy.id})).record.commentCount,100);
 await write(owner,"edit",{recordId:post.id,audience:"friends"});await deny(other);
 for(const input of [{module:"short",text:"Video",fileIds:[video.id]},{module:"market",title:"Product",text:"Description",priceSatang:500,stock:2,fileIds:[gif.id]}]){
  const item=(await write(owner,input.module==="market"?"listing":"publish",input)).record;
  assert.equal((await service.read({user:friend,recordId:item.id})).record.commentCount,0);
  const comment=(await write(friend,"comment",{recordId:item.id,text:"Shared feed comments"})).record;
  assert.equal((await service.read({user:owner,recordId:item.id})).record.commentCount,1);
  await write(friend,"delete",{recordId:comment.id});assert.equal((await service.read({user:owner,recordId:item.id})).record.commentCount,0);
 }
 const live=(await write(owner,"live-start",{title:"Live comments"})).record;
 await assert.rejects(()=>write(friend,"live-chat",{recordId:live.id,text:"before join"}),/social_join_required/);
 await assert.rejects(()=>write(friend,"comment",{recordId:live.id,text:"wrong comment type"}),/social_invalid_target/);
 await write(friend,"like",{recordId:live.id});assert.equal((await service.read({user:friend,recordId:live.id})).record.liked,true);
 await write(friend,"live-join",{recordId:live.id});
 const chat=(await write(friend,"live-chat",{recordId:live.id,text:"Live chat"})).record;
 assert.equal((await service.read({user:owner,recordId:live.id})).record.commentCount,1);
 await assert.rejects(()=>write(owner,"delete",{recordId:chat.id}),/social_not_found/);
 await write(friend,"delete",{recordId:chat.id});assert.equal((await service.read({user:owner,recordId:live.id})).record.commentCount,0);
 await assert.rejects(()=>write(friend,"live-chat",{recordId:live.id,text:"  "}),/social_empty_post/);
 await write(owner,"live-end",{recordId:live.id});await assert.rejects(()=>write(friend,"live-chat",{recordId:live.id,text:"after end"}),/social_join_required/);
 console.log("Watch: accepted-friends audience protects feed/records/comments/GIFs, followers and pending requests denied, unfriend revokes access, own-comment deletion, legacy Watch routing and exact visible counts beyond 100 passed");
}
if(require.main===module)suite(new SocialRepository({allowMemory:true})).catch(e=>{console.error(e);process.exitCode=1;});
module.exports={suite};
