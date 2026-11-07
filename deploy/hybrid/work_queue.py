"""Bounded, per-account FIFO admission; requests live only for their HTTP lifetime."""
import asyncio, time
from contextlib import asynccontextmanager

class QueueError(Exception):
    def __init__(self, code, status=429):
        super().__init__(code); self.code=code; self.status=status

class WorkQueue:
    def __init__(self, capacity=4, wait_seconds=45, interval=.2):
        self.capacity=capacity; self.wait_seconds=wait_seconds; self.interval=interval
        self.pending=[]; self.active=None

    def status(self, owner=None):
        position=next((i+1 for i,j in enumerate(self.pending) if j['owner']==owner),None)
        return {'waiting':len(self.pending),'capacity':self.capacity,'running':self.active is not None,
                'yourPosition':position,'yourRunning':bool(self.active and self.active['owner']==owner),
                'maxWaitSeconds':self.wait_seconds,'perAccountLimit':1}

    @asynccontextmanager
    async def lease(self, owner, ready, disconnected):
        if (self.active and self.active['owner']==owner) or any(j['owner']==owner for j in self.pending):
            raise QueueError('local_account_busy')
        # One running plus capacity waiting; when blocked on resources all are waiting.
        if len(self.pending)>=self.capacity:raise QueueError('local_queue_full')
        job={'owner':owner,'since':time.monotonic()}; self.pending.append(job)
        try:
            while True:
                if await disconnected():raise QueueError('local_cancelled',499)
                if time.monotonic()-job['since']>=self.wait_seconds:raise QueueError('local_queue_timeout',503)
                if self.active is None and self.pending[0] is job:
                    if await ready():
                        self.pending.pop(0);self.active=job;break
                await asyncio.sleep(self.interval)
            yield
        finally:
            if job in self.pending:self.pending.remove(job)
            if self.active is job:self.active=None

def resource_reason(*,ram_used,total,available,local_ram,vram,cpu,model_loaded,voice_loaded,kind='chat',latched=False,cold_budget=6.5):
    """Conservative cold-load estimate; no global OS hard cap or measured 8B peak claim."""
    if available<1536*1024**2 or ram_used>=(.60 if latched else .65):return 'ram_pressure'
    if vram is None:return 'gpu_metrics_unavailable'
    if vram>=(.55 if latched else .60):return 'vram_pressure'
    if local_ram>total*.60:return 'ram_pressure'
    if cpu>=65:return 'cpu_pressure'
    # Include load transients, not just the final model working set.
    budget=(cold_budget if not model_loaded else .5) if kind=='chat' else (.25 if voice_loaded else 2.0)
    if ram_used*total+budget*1024**3>total*.65:return 'ram_headroom'
    return None
