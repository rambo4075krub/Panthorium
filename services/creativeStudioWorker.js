'use strict';

// Notebook polling only advances durable, previously approved jobs. Each tick
// claims at most one existing job; repository leases also cover browser polling.
class CreativeStudioWorker {
  constructor({ studio, intervalMs = 15000, onError = () => {}, schedule = setTimeout, cancel = clearTimeout } = {}) {
    this.studio=studio;this.intervalMs=Math.max(5000,Number(intervalMs)||15000);
    this.onError=onError;this.schedule=schedule;this.cancel=cancel;
    this.timer=null;this.running=false;this.enabled=false;
  }
  start() { if(this.enabled)return;this.enabled=true;this.queue(); }
  queue() {
    if(!this.enabled||this.timer||this.running)return;
    this.timer=this.schedule(()=>{this.timer=null;void this.tick();},this.intervalMs);
    this.timer?.unref?.();
  }
  async tick() {
    if(!this.enabled||this.running)return;
    this.running=true;
    try { await this.studio.tick(); }
    catch(error) { try { this.onError(error); } catch (_) {} }
    finally { this.running=false;this.queue(); }
  }
  stop() { this.enabled=false;if(this.timer)this.cancel(this.timer);this.timer=null; }
}
module.exports={CreativeStudioWorker};
