'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { JSDOM } = require('jsdom');
const catalog = require('../notification-event-catalog');
const tick = () => new Promise(resolve => setTimeout(resolve, 15));
const defaults = () => ({ enabled: true, events: { ...catalog.defaults }, channels: { inApp: true, browser: false, sound: false, voice: false }, categories: Object.fromEntries(['system', 'security', 'operations', 'reminders', 'calendar', 'files', 'social', 'billing', 'ai'].map(k => [k, true])), quietHours: { enabled: false, start: '22:00', end: '07:00', timeZone: 'Asia/Bangkok' }, privacyPreview: false, askBeforeNotify: true });
const clone = x => JSON.parse(JSON.stringify(x));
const merge = (a, b) => { for (const [k, v] of Object.entries(b)) a[k] = v && typeof v === 'object' ? merge(a[k] || {}, v) : v; return a; };
(async () => {
  const dom = new JSDOM('<body><div id="system-controls-left"></div><main></main></body>', { url: 'https://panthorium.test', runScripts: 'outside-only', pretendToBeVisual: true });
  const w = dom.window, calls = [], spoken = [], notices = [];
  let settings = defaults(), items = [], failPatch = false, permissionCalls = 0, permission = 'default', busy = false;
  w.OS = { state: { user: { sub: 'guest:test', roles: ['guest'], permissions: ['chat'] } }, config: { backendUrl: 'https://panthorium.test' }, windows: new Map() };
  w.PanthoriumLiveVoice = { isBusy: () => busy };
  w.SpeechSynthesisUtterance = function (text) { this.text = text; };
  w.speechSynthesis = { speaking: false, speak: x => spoken.push(x), cancel: () => { w.speechSynthesis.speaking = false; } };
  class Notification {
    constructor(title, options) { this.title = title; this.options = options; this.closed = false; notices.push(this); }
    close() { this.closed = true; this.onclose?.(); }
    static get permission() { return permission; }
    static async requestPermission() { permissionCalls++; return permission; }
  }
  w.Notification = Notification;
  const payload = () => ({ ok: true, settings: clone(settings), items: clone(items), unreadCount: items.filter(x => !x.readAt).length, nextCursor: null });
  const normalFetch = async (url, opts = {}) => {
    calls.push({ url, opts });
    if (opts.method === 'PATCH') {
      if (failPatch) return { ok: false, json: async () => ({ ok: false, error: 'test_write_failure' }) };
      merge(settings, JSON.parse(opts.body));
    }
    return { ok: true, json: async () => payload() };
  };
  w.authorizedFetch = normalFetch;
  w.eval(fs.readFileSync('notification-event-catalog.js', 'utf8'));
  w.eval(fs.readFileSync('notifications-ui.js', 'utf8'));
  const root = w.document.querySelector('main');
  w.PanthoriumNotifications.mount(root); await tick();
  assert.equal(calls.length, 0, 'guests must not read another account notification feed');
  assert.equal(w.document.getElementById('panthorium-notification-bell'), null);
  const switchAccount = sub => { w.OS.state.user = { sub, permissions: ['chat'], roles: ['user'] }; w.dispatchEvent(new w.Event('panthorium:auth-changed')); };
  const item = (id, type = 'action.succeeded') => ({ id, type, category: 'operations', title: '<img src=x onerror=alert(1)> private task', body: '<script>secret()</script>', createdAt: '2026-10-24T12:00:00Z', readAt: null });
  items = [item('old')]; switchAccount('alpha'); await w.PanthoriumNotifications.refresh();
  const setting = key => root.querySelector('[data-notification-setting="' + key + '"]');
  assert.equal(root.dataset.notificationReady, 'true');
  assert.equal(root.querySelectorAll('[role=switch]').length, 18 + catalog.entries.length);
  const eventList = root.querySelector('[data-notification-event-list]'), advanced = () => root.querySelector('[data-notification-advanced]'), history = root.querySelector('[data-notification-history]');
  assert.equal(history.open, false); assert.equal(advanced().open, false);
  assert(eventList.compareDocumentPosition(history) & w.Node.DOCUMENT_POSITION_FOLLOWING, 'event choices precede collapsed history');
  assert.deepEqual([...eventList.querySelectorAll('[data-notification-event]')].map(row => row.dataset.notificationEvent), catalog.entries.map(row => row.id), 'all concrete notification rows follow the shared fixed order');
  assert.match(eventList.querySelector('.pn-event-columns').textContent, /รายการแจ้งเตือนปิด-เปิด/);
  advanced().open = true;
  setting('events.operation_succeeded').focus(); setting('events.operation_succeeded').click(); await tick();
  assert.equal(settings.events.operation_succeeded, false); assert.equal(settings.events.operation_failed, true, 'success and failure choices are independent');
  assert.equal(w.document.activeElement.dataset.notificationSetting, 'events.operation_succeeded', 'keyboard focus survives server save and rerender');
  assert.equal(advanced().open, true, 'advanced disclosure state survives saving a row');
  await w.PanthoriumNotifications.refresh(); assert.equal(setting('events.operation_succeeded').getAttribute('aria-checked'), 'false', 'saved event survives refresh');
  setting('events.operation_succeeded').click(); await tick();
  setting('categories.operations').click(); await tick();
  assert.equal(setting('events.operation_succeeded').getAttribute('aria-checked'), 'false');
  setting('events.operation_succeeded').click(); await tick();
  assert.equal(settings.categories.operations, true); assert.equal(settings.events.operation_succeeded, true);
  assert.equal(settings.events.operation_failed, false); assert.equal(settings.events.operation_started, false, 'enabling a child cannot turn on muted siblings');
  settings.events = { ...catalog.defaults }; await w.PanthoriumNotifications.refresh();
  assert.equal(permissionCalls, 0, 'loading settings must never request browser permission');
  assert.equal(notices.length, 0, 'do not replay old notifications after signing in');
  assert.equal(root.querySelectorAll('img,script').length, 0, 'untrusted titles and content render as text');
  assert.match(root.textContent, /<script>secret\(\)<\/script>/);
  failPatch = true; setting('categories.operations').click(); await tick();
  assert.equal(setting('categories.operations').getAttribute('aria-checked'), 'true', 'failed writes keep last confirmed switch state');
  assert.match(root.textContent, /บันทึกไม่สำเร็จ/);
  failPatch = false; setting('categories.operations').click(); await tick();
  assert.equal(setting('categories.operations').getAttribute('aria-checked'), 'false');
  setting('categories.operations').click(); await tick();
  permission = 'denied'; setting('channels.browser').click(); await tick();
  assert.equal(permissionCalls, 1); assert.equal(settings.channels.browser, false);
  permission = 'granted'; setting('channels.browser').click(); await tick();
  assert.equal(settings.channels.browser, true);
  setting('channels.voice').click(); await tick();
  items.unshift(item('new')); await w.PanthoriumNotifications.refresh();
  assert.equal(notices.length, 1); assert.equal(spoken.length, 1);
  assert.doesNotMatch(notices[0].options.body + spoken[0].text, /private task|secret/, 'private previews are generic by default');
  assert.match(spoken[0].text, /มีการแจ้งเตือนใหม่/);
  busy = true; items.unshift(item('during-live')); await w.PanthoriumNotifications.refresh();
  assert.equal(spoken.length, 1, 'automatic speech must never interrupt live microphone/dialogue');
  const explicit = await w.PanthoriumNotifications.readAloud(); assert.equal(explicit.error, 'notification_voice_busy'); busy = false;
  const fixed = Date.parse('2026-10-24T23:30:00+07:00');
  w.Date = class extends Date { constructor(...args) { super(...(args.length ? args : [fixed])); } static now() { return fixed; } };
  settings.quietHours.enabled = true; items.unshift(item('quiet')); await w.PanthoriumNotifications.refresh();
  assert.equal(spoken.length, 1, 'overnight quiet hours suppress automatic speech');
  assert.equal(notices.length, 2, 'overnight quiet hours suppress browser alerts');
  settings.quietHours.enabled = false; settings.enabled = false; items.unshift(item('disabled')); await w.PanthoriumNotifications.refresh();
  assert.equal(spoken.length, 1); assert.equal(notices.length, 2);
  settings.enabled = true; await w.PanthoriumNotifications.refresh();
  assert.equal(spoken.length, 1, 'enabling does not replay quiet or disabled alerts');

  settings.privacyPreview = true; await w.PanthoriumNotifications.refresh();
  let resolveStale; const stale = payload();
  w.authorizedFetch = (url, opts = {}) => opts.method === 'PATCH' ? normalFetch(url, opts) : new Promise(resolve => { resolveStale = resolve; });
  const oldRefresh = w.PanthoriumNotifications.refresh(); await tick();
  setting('privacyPreview').click(); await tick();
  assert.equal(settings.privacyPreview, false);
  resolveStale({ ok: true, json: async () => stale }); await oldRefresh;
  assert.equal(w.PanthoriumNotifications.getState().settings.privacyPreview, false, 'a pre-save list response cannot restore private speech previews');

  let resolveAccount; w.authorizedFetch = () => new Promise(resolve => { resolveAccount = resolve; });
  const pending = w.PanthoriumNotifications.refresh(); await tick();
  const oldNotices = notices.slice(); settings = defaults(); items = [];
  w.authorizedFetch = normalFetch; switchAccount('beta'); await w.PanthoriumNotifications.refresh();
  resolveAccount({ ok: true, json: async () => stale }); await pending;
  assert.doesNotMatch(root.textContent, /private task|secret/);
  assert.equal(w.PanthoriumNotifications.getState().unreadCount, 0);
  assert(oldNotices.every(n => n.closed), 'switching account closes previously displayed device notices');
  assert.equal(root.querySelectorAll('[data-notification-id]').length, 0);
  const deliveredBefore = notices.length, spokenBefore = spoken.length;
  settings.channels.browser = true; settings.channels.voice = true;
  settings.events.operation_succeeded = false; settings.events.operation_failed = true;
  await w.PanthoriumNotifications.refresh();
  items.unshift(item('success-muted')); await w.PanthoriumNotifications.refresh();
  assert.equal(notices.length, deliveredBefore); assert.equal(spoken.length, spokenBefore);
  assert.equal(w.document.querySelector('[data-notification-toast]'), null, 'muted success produces no in-app, device or voice alert');
  items.unshift(item('failure-enabled', 'action.failed')); await w.PanthoriumNotifications.refresh();
  assert.equal(notices.length, deliveredBefore + 1); assert.equal(spoken.length, spokenBefore + 1);
  assert(w.document.querySelector('[data-notification-toast]'), 'enabled failure still alerts');
  assert(root.querySelector('[data-notification-id="success-muted"]'), 'disabled delivery retains reviewable history');
  let contexts = 0, closed = 0;
  w.AudioContext = class {
    constructor() { contexts++; this.state = 'suspended'; this.currentTime = 0; this.destination = {}; }
    async resume() { this.state = 'running'; }
    async close() { this.state = 'closed'; closed++; }
    createOscillator() { return { frequency: {}, connect() {}, start() {}, stop() {} }; }
    createGain() { return { gain: { setValueAtTime() {}, exponentialRampToValueAtTime() {} }, connect() {} }; }
  };
  settings.channels.sound = true; await w.PanthoriumNotifications.refresh();
  assert.equal(contexts, 0, 'a stored sound switch is not browser playback permission');
  assert.match(root.textContent, /หลังเปิดหน้าใหม่/);
  root.querySelector('[data-notification-audio-unlock]').click(); await tick();
  assert.equal(contexts, 1, 'explicit device test unlocks stored sound preference after reload');
  assert.match(spoken.at(-1).text, /ทดสอบเสียง/);
  assert.match(root.textContent, /ส่งเสียงทดสอบแล้ว/);
  let deviceActive=false, registrations=0, popupCalls=0, registeredDevice=false;
  w.PanthoriumPush={active:()=>deviceActive,native:()=>false,desktop:()=>false,
    enable:async()=>{registrations++;deviceActive=true;},disconnect:async()=>{deviceActive=false;},
    show:async()=>{popupCalls++;return true;},check:async()=>({registered:registeredDevice})};
  await w.PanthoriumNotifications.refresh();
  assert(w.document.querySelector('[data-notification-opt-in]'),'inactive devices get a permission-free opt-in card');
  assert.equal(registrations,0,'loading cannot register a device or prompt for permission');
  setting('channels.browser').click();await tick();
  assert.equal(settings.channels.browser,false);
  setting('channels.browser').click();await tick();
  assert.equal(registrations,1,'one channel action also registers the device');
  assert.equal(settings.channels.browser,true);assert(deviceActive);
  assert.equal(w.document.querySelector('[data-notification-opt-in]'),null);
  const sends=()=>calls.filter(c=>c.url.endsWith('/send')).length;
  w.PanthoriumPush.desktop=()=>true;
  root.querySelector('[data-notification-popup-test]').click();await tick();
  assert.equal(sends(),0,'stale device registration cannot be reported as a successful test');
  registeredDevice=true;
  root.querySelector('[data-notification-popup-test]').click();await tick();
  assert.equal(sends(),1,'test uses the authenticated self-notification endpoint');
  deviceActive=false;items.unshift(item('stale-registration','action.failed'));
  await w.PanthoriumNotifications.refresh();await tick();
  assert.equal(popupCalls,1,'stale background state cannot suppress foreground delivery');
  w.PanthoriumPush.desktop=()=>false;
  setting('channels.browser').click();await tick();
  const setTimer=w.setTimeout.bind(w);w.setTimeout=(fn,ms,...args)=>setTimer(fn,ms===20000?1:ms,...args);
  w.PanthoriumPush.enable=()=>new Promise(()=>{});
  setting('channels.browser').click();await tick();await tick();
  assert.equal(settings.channels.browser,true,'a stalled Web Push provider cannot block foreground popup opt-in');
  assert.match(root.textContent,/เปิดป๊อปอัปขณะเปิดเว็บแล้ว/);
  assert.equal(deviceActive,false,'foreground fallback must not claim background readiness');
  registeredDevice=false;root.querySelector('[data-notification-popup-test]').click();await tick();
  assert.equal(sends(),2);assert.match(root.textContent,/การรับเบื้องหลังยังไม่พร้อม/);
  deviceActive=true;w.dispatchEvent(new w.Event('panthorium:push-changed'));
  assert.equal(w.document.querySelector('[data-notification-opt-in]'),null,'late registration success clears the foreground-only offer');
  w.setTimeout=setTimer;
  w.OS.state.user = null; w.dispatchEvent(new w.Event('panthorium:auth-changed'));
  assert.equal(w.PanthoriumNotifications.getState(), null);
  assert.equal(w.document.getElementById('panthorium-notification-bell'), null);
  assert.equal(closed, 1, 'logout closes notification audio context');
  assert.equal(w.document.querySelector('[data-notification-opt-in]'),null,'account changes remove opt-in cards');
  dom.window.close();
  console.log('Notifications UI: ordered event switches, independent persisted choices, keyboard focus, category migration, delivery filters, permissions, privacy, quiet hours and account isolation passed');
})().catch(error => { console.error(error); process.exitCode = 1; });
