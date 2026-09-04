class ConcurrencyGate {
  constructor({limit=8,maxQueue=32,queueTimeoutMs=15000,audit,name='ai'}={}){this.limit=Math.max(1,Number(limit)||8);this.maxQueue=Math.max(0,Number(maxQueue)||32);this.queueTimeoutMs=Math.max(1000,Number(queueTimeoutMs)||15000);this.audit=audit;this.name=name;this.active=0;this.queue=[];}
  stats(){return{name:this.name,active:this.active,limit:this.limit,queued:this.queue.length,maxQueue:this.maxQueue};}
  async acquire(){if(this.active<this.limit){this.active++;return()=>this.release();}if(this.queue.length>=this.maxQueue){this.audit?.record('production.backpressure_rejected',{gate:this.name,...this.stats()});const e=new Error('system_busy');e.code='system_busy';throw e;}return new Promise((resolve,reject)=>{const item={resolve,reject,timer:null};item.timer=setTimeout(()=>{const i=this.queue.indexOf(item);if(i>=0)this.queue.splice(i,1);this.audit?.record('production.backpressure_timeout',{gate:this.name,...this.stats()});const e=new Error('system_busy');e.code='system_busy';reject(e);},this.queueTimeoutMs);this.queue.push(item);});}
  release(){this.active=Math.max(0,this.active-1);const next=this.queue.shift();if(next){clearTimeout(next.timer);this.active++;next.resolve(()=>this.release());}}
  async run(fn){const release=await this.acquire();try{return await fn();}finally{release();}}
}
module.exports={ConcurrencyGate};
