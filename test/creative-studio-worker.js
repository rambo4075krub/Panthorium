'use strict';
const assert=require('node:assert/strict');
const {CreativeStudioWorker}=require('../services/creativeStudioWorker');
(async()=>{
 let calls=0,errors=0,release,callback,cancelled=0;
 const worker=new CreativeStudioWorker({studio:{tick:()=>{calls++;return new Promise(resolve=>release=resolve);}},onError:()=>errors++,schedule:fn=>{callback=fn;return{unref(){}};},cancel:()=>cancelled++});
 worker.start();const initial=worker.timer;worker.start();assert.equal(worker.timer,initial);
 callback();assert.equal(calls,1);await worker.tick();assert.equal(calls,1,'slow provider work cannot overlap');
 worker.stop();release();await new Promise(resolve=>setImmediate(resolve));assert.equal(worker.timer,null,'shutdown cannot reschedule');
 worker.start();assert(worker.timer);worker.stop();assert.equal(cancelled,1);
 worker.studio.tick=async()=>{calls++;throw Error('temporary DB disconnect');};
 worker.start();callback();await new Promise(resolve=>setImmediate(resolve));assert.equal(errors,1);assert(worker.timer,'recover by scheduling the next bounded check');worker.stop();
 await worker.tick();assert.equal(calls,2,'stopped worker never advances jobs');
 console.log('Creative notebook worker: bounded serial work, transient recovery and shutdown passed');
})().catch(error=>{console.error(error);process.exitCode=1;});
