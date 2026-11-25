"use strict";
const assert=require("node:assert/strict");
const {randomUUID,randomBytes}=require("node:crypto");
const {Pool}=require("pg");
const express=require("express");
const {AuthService}=require("../services/authService");
const {PostgresAuthRepository}=require("../repositories/authRepository");
const {SocialRepository}=require("../services/socialRepository");
const {SocialService}=require("../services/socialService");
const {MarketingService}=require("../services/marketingService");
const {MarketingRunner}=require("../services/marketingRunner");
const {createMarketingRouter}=require("../routes/marketing");
const {offer,botAnswer}=require("../services/marketingCatalog");
async function suite(pool) {
  const accounts=Object.assign(Object.create(PostgresAuthRepository.prototype),{pool});
  await accounts.init();
  const auth=new AuthService({config:{},repository:accounts,audit:{record(){}}});
  const staff=await accounts.createUser({id:randomUUID(),username:"desk",passwordHash:"fixture",roles:["administrator"],permissions:["settings","chat"]});
  const principal=u=>({...u,sub:u.id});
  const admin=principal(staff);
  const member=async i=>principal(await accounts.createUser({id:randomUUID(),username:"test-"+i,passwordHash:"fixture",roles:[],permissions:["chat"]}));
  const old=await member(1), others=await Promise.all([2,3,4].map(member));
  const social=new SocialService({repository:new SocialRepository({pool}),accounts,supportAdminUsername:"desk"});
  await social.init(); auth.onCustomerCreated=u=>social.provisionSupport(u);
  await social.backfillSupport();
  const newUser=principal(await auth.createEmailAccount("new@example.test","fixture-only-passphrase"));
  const users=[old,...others,newUser];
  await social.backfillSupport();
  const list=await social.read({user:admin,module:"talk"});
  assert.equal(list.items.length,5);
  const room=(await social.read({user:newUser,module:"talk"})).items[0];
  assert.equal(room.peer.name,"Panthorium");
  assert.equal(room.title,"Panthorium"); assert.equal(room.members.length,2);
  await assert.rejects(()=>social.read({user:old,recordId:room.id}),e=>e.status===404);
  const faq=()=>social.write({user:newUser,action:"message",input:{recordId:room.id,text:"ราคาแพ็กเกจเท่าไหร่"},requestId:"faq-once"});
  await Promise.all([faq(),faq()]);
  let history=await social.read({user:newUser,recordId:room.id});
  assert.equal(history.items.length,2); assert.equal(history.items.filter(r=>r.officialBot).length,1);
  assert(history.items.find(r=>r.officialBot).text.includes("Life"));
  await social.write({user:admin,action:"message",input:{recordId:room.id,text:"แอดมินรับเรื่องแล้ว"}});
  await social.write({user:newUser,action:"message",input:{recordId:room.id,text:"มีโปรโมชั่นไหม"}});
  history=await social.read({user:newUser,recordId:room.id});
  assert.equal(history.items.filter(r=>r.officialBot).length,1);
  assert.equal(offer("storage-20","activation"),null);
  assert.equal(offer("free-tokens-20261018","activation",Date.parse("2026-12-01T00:00:00+07:00")),null);
  assert(!botAnswer("plans").includes("นัดแนะนำ"));
  let calls=0;
  const runner={available:()=>true,stop(){},async generate(input){calls++; assert.deepEqual(Object.keys(input).sort(),["activity","products"]); assert(!JSON.stringify(input).includes("@"));return {product:"free",objective:"activation",experiment:"ทดสอบการเริ่มใช้งาน"};}};
  const svc=new MarketingService({pool,runner,web:{execute:async()=>({available:true,results:[]})}});
  await svc.init();
  assert.deepEqual(await svc.preferences(old),{analytics:false,offers:false});
  for (const u of users) await svc.observe(u,"market");
  assert.deepEqual(await svc.summary(),[]);
  for (const u of users) {await svc.setPreference(u,"analytics",true);await svc.observe(u,"market");await svc.observe(u,"market");}
  assert.deepEqual(await svc.summary(),[{feature:"market",people:5}]);
  await svc.setPreference(old,"analytics",false); assert.deepEqual(await svc.summary(),[]);
  await Promise.all([svc.tick(),new MarketingService({pool,runner}).tick()]); await svc.tick();
  assert.equal(calls,1); assert.equal((await svc.dashboard()).runs[0].status,"ready");
  const campaign={id:randomUUID(),product:"guided-setup",objective:"activation",starts:new Date(Date.now()-3000).toISOString(),
    ends:new Date(Date.now()+86400000).toISOString(),limit:1};
  await assert.rejects(()=>svc.publish(old,campaign),e=>e.status===403);
  await assert.rejects(()=>svc.publish(admin,{...campaign,product:"storage-20"}),e=>e.status===409);
  await svc.publish(admin,campaign); await svc.publish(admin,campaign);
  assert.deepEqual(await svc.offers(old),[]);
  await Promise.all(users.slice(0,2).map(u=>svc.setPreference(u,"offers",true)));
  const delivered=await Promise.all(users.slice(0,2).map(u=>svc.offers(u)));
  assert.equal(delivered.flat().length,1);
  const winner=users[delivered.findIndex(r=>r.length)];
  assert.equal((await svc.offers(winner))[0].action,"contact");
  assert.equal((await svc.dashboard()).campaigns[0].reached,1);
  await svc.setPreference(winner,"offers",false); assert.deepEqual(await svc.offers(winner),[]);
  await svc.setPreference(winner,"offers",true); await svc.stopCampaign(campaign.id); assert.deepEqual(await svc.offers(winner),[]);
  const future={...campaign,id:randomUUID(),starts:new Date(Date.now()+86400000).toISOString(),ends:new Date(Date.now()+172800000).toISOString()};
  await svc.publish(admin,future); assert.deepEqual(await svc.offers(winner),[]);
  assert.equal(new MarketingRunner().available(),false);
  const FixtureAuth=require("./auth-fixture").AuthService;
  const tokens=new FixtureAuth({config:{jwtSecret:"marketing-http-fixture-key",accessTokenTtl:"1h"},audit:{record(){}}});
  const app=express();app.use(express.json());app.use("/api/marketing",createMarketingRouter(tokens,svc,social));
  const server=app.listen(0,"127.0.0.1"); await new Promise(done=>server.once("listening",done));
  try {
    const call=(path,u)=>fetch("http://127.0.0.1:"+server.address().port+"/api/marketing"+path,{headers:u?{Authorization:"Bearer "+tokens.signAccessToken(u)}:{}});
    assert.equal((await call("/admin")).status,401); assert.equal((await call("/admin",old)).status,403);
    assert.equal((await call("/admin",admin)).status,200); assert.equal((await call("/preferences",{...old,roles:["guest"]})).status,403);
  } finally { await new Promise(done=>server.close(done)); }
}
(async()=>{
  if (!process.env.TEST_DATABASE_URL) {if (process.env.CI) throw Error("TEST_DATABASE_URL required");return;}
  const schema="marketing_test_"+randomBytes(8).toString("hex"),base=new Pool({connectionString:process.env.TEST_DATABASE_URL});
  let pool;
  try {
    await base.query("CREATE SCHEMA "+schema);
    pool=new Pool({connectionString:process.env.TEST_DATABASE_URL,max:8,options:"-c search_path="+schema+",public"});
    await suite(pool); console.log("Marketing and official Chat PostgreSQL tests passed");
  } finally {await pool?.end();await base.query("DROP SCHEMA IF EXISTS "+schema+" CASCADE");await base.end();}
})().catch(e=>{console.error(e);process.exitCode=1;});
