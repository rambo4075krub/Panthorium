"""Bounded, per-account FIFO admission; requests live only for their HTTP lifetime."""
import asyncio, math, time
from contextlib import asynccontextmanager

class QueueError(Exception):
    def __init__(self, code, status=429):
        super().__init__(code); self.code=code; self.status=status

def admission_ready(snapshot):
    """Do not queue a request that cannot start within the resource contract.

    CPU load can subside while waiting. Missing RAM/VRAM or monitoring requires
    a new admission attempt; never load a model to discover the limit by OOM.
    """
    if snapshot.get('ready'): return True
    reason=snapshot.get('reason')
    if reason in {'ram_headroom','ram_pressure','vram_pressure','gpu_temperature',
                  'gpu_metrics_unavailable','resource_monitor_unavailable','model_not_installed'}:
        raise QueueError('local_resource_'+reason,503)
    return False

def memory_budget(*,ram_used,total,model_loaded,voice_loaded,kind='chat',cold_budget=6.5,limits=None):
    limits=limits or {}
    budget=(cold_budget if not model_loaded else limits.get('warmRamBudgetGiB',.5)) if kind=='chat' else (.25 if voice_loaded else 2.0)
    required=math.ceil(budget*1024**3)
    headroom=total*limits.get('ramLimit',.65)-ram_used*total
    return {'ramTotalBytes':total,'ramHeadroomBytes':max(0,int(headroom)),
            'ramRequiredAdditionalBytes':required,
            'ramShortfallBytes':max(0,math.ceil(required-headroom))}

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

def ram_pressure(ram_used, available, limits=None, latched=False):
    limits=limits or {}
    return (available<limits.get('minimumAvailableGiB',1.5)*1024**3 or
            ram_used>=limits.get('ramRecovery' if latched else 'ramLimit',.60 if latched else .65))

def resource_reason(*,ram_used,total,available,local_ram,vram,cpu,model_loaded,voice_loaded,kind='chat',latched=False,cold_budget=6.5,limits=None,vram_total=None,gpu_temperature=None):
    """Model-specific forecasts plus sampled pressure limits; not an OS hard cap."""
    limits=limits or {}
    if ram_pressure(ram_used,available,limits,latched):return 'ram_pressure'
    if vram is None:return 'gpu_metrics_unavailable'
    if vram>=limits.get('vramRecovery' if latched else 'vramLimit',.55 if latched else .60):return 'vram_pressure'
    if limits.get('gpuTemperatureLimit'):
        if gpu_temperature is None:return 'gpu_metrics_unavailable'
        if gpu_temperature>=limits.get('gpuTemperatureRecovery' if latched else 'gpuTemperatureLimit'):return 'gpu_temperature'
    if kind=='chat' and not model_loaded and limits.get('coldVramBudgetGiB'):
        if not vram_total:return 'gpu_metrics_unavailable'
        if (limits['vramLimit']-vram)*vram_total<limits['coldVramBudgetGiB']*1024**3:return 'vram_pressure'
    if local_ram>total*.60:return 'ram_pressure'
    # Include load transients, not just the final model working set.
    if memory_budget(ram_used=ram_used,total=total,model_loaded=model_loaded,
                     voice_loaded=voice_loaded,kind=kind,cold_budget=cold_budget,limits=limits)['ramShortfallBytes']:
        return 'ram_headroom'
    if cpu>=65:return 'cpu_pressure'
    return None
