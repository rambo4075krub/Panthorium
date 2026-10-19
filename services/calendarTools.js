'use strict';
const stamp = value => typeof value === 'string' && /^\d{4}-\d\d-\d\dT(?:[01]\d|2[0-3]):[0-5]\d(?::[0-5]\d(?:\.\d{1,3})?)?(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)$/i.test(value) && dateOnly(value.slice(0,10)) && Number.isFinite(Date.parse(value));
const dateOnly = value => typeof value === 'string' && /^\d{4}-\d\d-\d\d$/.test(value) && Number.isFinite(Date.parse(value+'T00:00:00Z')) && new Date(value+'T00:00:00Z').toISOString().slice(0,10)===value;
const keys = (a,k) => a && typeof a==='object' && !Array.isArray(a) && Object.keys(a).every(x=>k.includes(x));
const text = (v,n) => typeof v==='string' && v.length<=n;
function safeOverride(value) {
 const out={};for(const key of ['title','location','description','timeZone'])if(typeof value?.[key]==='string')out[key]=value[key];
 for(const key of ['startsAt','endsAt'])if(stamp(value?.[key]))out[key]=value[key];return out;
}
function expand(event) {
  const starts = [event.startsAt,...(event.additionalStartsAt || [])];
  const duration = event.endsAt ? Date.parse(event.endsAt)-Date.parse(event.startsAt) : 0;
  const {additionalStartsAt,excludedStartsAt,occurrenceOverrides,...summary}=event;
  return starts.filter(stamp).filter(s=>!event.excludedStartsAt?.includes(s)).map(startsAt=>({...summary,startsAt,endsAt:duration ? new Date(Date.parse(startsAt)+duration).toISOString():null,...safeOverride(event.occurrenceOverrides?.[startsAt]),occurrenceAt:startsAt,expectedTitle:event.title,series:starts.length>1}));
}
function registerCalendarView(registry) {
  registry.register({id:'calendar.view',description:'Navigate calendar or show an add-event draft without saving data',permission:'chat',risk:'low',mutates:false,
    argsSchema:{action:'today,next_month,previous_month,date,new_event',date:'YYYY-MM-DD; required for date',title:'optional draft title'},
    validateArgs:a=> keys(a,['action','date','title']) && ['today','next_month','previous_month','date','new_event'].includes(a.action) && (a.date==null || dateOnly(a.date)) && (a.action!=='date'||dateOnly(a.date)) && (a.title==null || text(a.title,240)) ? null:'invalid_calendar_view',
    run:async({args})=>({uiAction:'calendar_view:'+encodeURIComponent(JSON.stringify(args))})});
}
async function queryCalendar(memory,user,args,asCalendar) {
  const out = memory.calendarList ? await memory.calendarList({user}) : await memory.list({user,kind:'calendar-event',limit:100});
  if (!out?.ok) throw new Error(out?.error||'calendar_unavailable');
  let sourceTruncated = out.truncated === true || (!memory.calendarList && out.memories.length>=100);
  let events=[];
  for(const record of out.memories){const event=asCalendar(record);if(event)events.push(...expand(event));if(events.length>25000){sourceTruncated=true;events=events.slice(0,25000);break;}}
  events.sort((a,b)=>Date.parse(a.startsAt)-Date.parse(b.startsAt));
  const start=args.from ? Date.parse(args.from):-Infinity, end=args.to ? Date.parse(args.to):Infinity;
  events=events.filter(e=>Date.parse(e.startsAt)<end && (e.endsAt ? Date.parse(e.endsAt)>start : Date.parse(e.startsAt)>=start));
  if(args.query){const q=args.query.normalize('NFKC').toLowerCase();events=events.filter(e=>[e.title,e.description,e.location].join(' ').normalize('NFKC').toLowerCase().includes(q));}
  const conflicts=[];
  if(args.action==='conflicts')for(let i=0;i<events.length && conflicts.length<100;i++)for(let j=i+1;j<events.length && Date.parse(events[j].startsAt)<Date.parse(events[i].endsAt||events[i].startsAt);j++){
    conflicts.push({first:events[i],second:events[j]});if(conflicts.length>=100)break;
  }
  let freeSlots;
  if(args.action==='availability'){
    if(sourceTruncated || events.some(e=>!e.endsAt))return {events:events.slice(0,100),freeSlots:[],complete:false,reason:sourceTruncated?'calendar_result_truncated':'event_end_time_required'};
    let cursor=start;freeSlots=[];
    for(const e of events){const s=Math.max(start,Date.parse(e.startsAt)),t=Math.min(end,Date.parse(e.endsAt));if(s-cursor >= (args.durationMinutes||30)*60000)freeSlots.push({startsAt:new Date(cursor).toISOString(),endsAt:new Date(s).toISOString()});cursor=Math.max(cursor,t);}
    if(end-cursor >= (args.durationMinutes||30)*60000)freeSlots.push({startsAt:new Date(cursor).toISOString(),endsAt:new Date(end).toISOString()});
  }
  const limit=args.limit||100;
  return {events:events.slice(0,limit),total:events.length,truncated:sourceTruncated||events.length>limit,complete:!sourceTruncated && (args.action!=='conflicts' || conflicts.length<100 && events.every(e=>e.endsAt)),...(args.action==='conflicts'?{conflicts:conflicts.slice(0,100)}:{}),...(freeSlots?{freeSlots}:{}),remindersAreSeparate:true};
}
function validateRead(a){
 if(!keys(a,['limit','query','from','to','action','durationMinutes']))return 'invalid_tool_args';
 if(a.limit!=null && (!Number.isInteger(a.limit)||a.limit<1||a.limit>100))return 'invalid_tool_args';
 if(a.query!=null && !text(a.query,240))return 'invalid_tool_args';
 if(a.action!=null && !['list','conflicts','availability'].includes(a.action))return 'invalid_tool_args';
 if((a.from!=null&&!stamp(a.from))||(a.to!=null&&!stamp(a.to))||(a.from&&a.to&&Date.parse(a.from)>=Date.parse(a.to)))return 'invalid_calendar_range';
 if(a.durationMinutes!=null&&(!Number.isInteger(a.durationMinutes)||a.durationMinutes<1||a.durationMinutes>1440))return 'invalid_calendar_range';
 if(a.action==='availability'&&(a.query || !a.from||!a.to||Date.parse(a.to)-Date.parse(a.from)>31*86400000))return 'invalid_calendar_range';
 return null;
}
module.exports={stamp,dateOnly,expand,registerCalendarView,queryCalendar,validateRead};
