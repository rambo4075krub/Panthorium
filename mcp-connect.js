(function () {
  'use strict';

  // The application JWT and approval hash stay in this closure, never in URLs or storage.
  const $ = id => document.getElementById(id);
  const mode = location.pathname === '/oauth/authorize' ? 'consent' : location.pathname === '/mcp/approve' ? 'action' : 'connections';
  const actionId = mode === 'action' ? new URLSearchParams(location.search).get('actionId') : null;
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const paidTools = new Set(['media.video.generate', 'media.video.plan_edit', 'media.video.ai_edit', 'media.video.transcribe']);
  const stateLabels = { proposed:'รอการตรวจสอบ', awaiting_confirmation:'รอการยืนยันจากคุณ', running:'กำลังดำเนินการ', succeeded:'ดำเนินการสำเร็จ', failed:'ดำเนินการไม่สำเร็จ', cancel_requested:'ส่งคำขอยกเลิกแล้ว', unknown:'ต้องตรวจสอบผลก่อนสั่งซ้ำ' };
  const errors = {
    invalid_credentials:'ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง', invalid_credentials_format:'กรุณาตรวจสอบชื่อผู้ใช้และรหัสผ่าน',
    account_suspended:'บัญชีนี้ถูกระงับ กรุณาตรวจสอบบัญชีใน Panthorium', account_access_expired:'สิทธิ์เข้าใช้บัญชีนี้หมดอายุแล้ว', account_day_restricted:'บัญชีนี้เข้าใช้ไม่ได้ในวันนี้',
    temporarily_blocked:'มีการเข้าสู่ระบบหลายครั้ง กรุณารอสักครู่แล้วลองใหม่', auth_unavailable:'ระบบเข้าสู่ระบบยังไม่พร้อม กรุณาลองอีกครั้ง',
    action_not_found:'ไม่พบคำสั่งนี้ในบัญชีของคุณ กรุณาตรวจสอบบัญชีที่เข้าสู่ระบบ', action_confirmation_expired:'คำสั่งนี้หมดเวลายืนยันแล้ว กรุณากลับไปขอคำสั่งใหม่ใน ChatGPT',
    action_approval_invalid:'ข้อมูลยืนยันไม่ถูกต้อง กรุณาโหลดหน้านี้ใหม่', tool_permission_denied:'บัญชีนี้ไม่มีสิทธิ์ใช้เครื่องมือดังกล่าว',
    action_cancelled:'คำสั่งนี้ถูกยกเลิกแล้ว', action_outcome_unknown:'ยังยืนยันผลของคำสั่งไม่ได้ กรุณาตรวจสอบใน Panthorium ก่อนสั่งซ้ำ',
    invalid_request:'คำขอเชื่อมต่อไม่ถูกต้องหรือหมดอายุ กรุณาเริ่มเชื่อมต่อจาก ChatGPT ใหม่', invalid_grant:'การเชื่อมต่อนี้หมดอายุหรือถูกยกเลิกแล้ว',
    oauth_request_expired:'คำขอเชื่อมต่อหมดอายุ กรุณาเริ่มจาก ChatGPT ใหม่', oauth_request_not_found:'ไม่พบคำขอเชื่อมต่อ กรุณาเริ่มจาก ChatGPT ใหม่',
    invalid_csrf:'คำขอไม่ผ่านการตรวจสอบ กรุณาเริ่มเชื่อมต่อจาก ChatGPT ใหม่', forbidden:'บัญชีนี้ไม่มีสิทธิ์ทำรายการนี้'
  };
  const scopeDescriptions = {
    'profile':'อ่านข้อมูลบัญชีพื้นฐานเพื่อแสดงว่ากำลังเชื่อมต่อบัญชีใด',
    'panthorium:read':'อ่านโปรไฟล์ ไฟล์ โน้ต ความทรงจำ ปฏิทิน เป้าหมาย งานเตือน ประวัติสนทนา และข้อมูลการใช้ AI ที่บัญชีนี้มีสิทธิ์เข้าถึง',
    'panthorium:write':'เสนอการเปลี่ยนข้อมูล โดยให้คุณตรวจสอบและยืนยันก่อนดำเนินการ',
    'panthorium:media':'เสนอการสร้างและตัดต่อสื่อ โดยให้คุณยืนยันงานที่มีค่าใช้จ่ายก่อนดำเนินการ',
    'offline_access':'คงการเชื่อมต่อจนกว่าคุณจะยกเลิกหรือสิทธิ์หมดอายุ'
  };
  let token = null, user = null, consent = null, action = null, busy = false, timer = null, authGeneration = 0;

  function showStatus(message, kind = '') {
    $('status').textContent = message;
    $('status').dataset.kind = kind;
    $('status').hidden = !message;
  }
  function errorMessage(error) {
    if (error.status === 429) return 'มีคำขอมากเกินไป กรุณารอสักครู่แล้วลองใหม่';
    if (error.status === 401 && error.code !== 'invalid_credentials') return 'เซสชันหมดอายุ กรุณาเข้าสู่ระบบอีกครั้ง';
    return errors[error.code] || error.publicMessage || 'ทำรายการไม่สำเร็จ กรุณาลองอีกครั้ง';
  }
  function expiry(value) {
    const date = new Date(value);
    return value && Number.isFinite(date.getTime()) ? date.toLocaleString('th-TH', { dateStyle:'medium', timeStyle:'short' }) : 'ไม่ระบุ';
  }
  function scopes(value) { return Array.isArray(value) ? value.map(String) : String(value || '').split(/\s+/).filter(Boolean); }
  function setBusy(value) {
    busy = value;
    for (const id of ['login-button','allow-button','deny-button','confirm-action','cancel-action','switch-account','refresh-grants']) $(id).disabled = value;
    if (!value && action) {
      $('confirm-action').disabled = !canApproveAction();
      $('cancel-action').disabled = !['awaiting_confirmation','proposed'].includes(action.state);
    }
  }
  function canApproveAction() {
    const deadline = Date.parse(action?.approvalExpiresAt);
    return !!action && ['awaiting_confirmation','proposed'].includes(action.state) && Number.isFinite(deadline) && deadline > Date.now() && /^[a-f0-9]{64}$/.test(action.approvalHash || '');
  }
  function hidePrivate() {
    for (const id of ['account-panel','consent-panel','action-panel','grants-panel']) $(id).hidden = true;
    consent = null; action = null;
    clearTimeout(timer);
  }
  function requireLogin(message) {
    token = null; user = null; authGeneration++;
    hidePrivate();
    $('login-panel').hidden = false;
    showStatus(message || 'กรุณาเข้าสู่ระบบเพื่อดำเนินการต่อ');
  }
  async function rawRequest(path, options = {}) {
    let response;
    try {
      response = await fetch(path, { credentials:'include', cache:'no-store', redirect:'error', ...options, headers:{ Accept:'application/json', ...(options.body ? { 'Content-Type':'application/json' } : {}), ...(options.headers || {}) } });
    } catch (_) {
      const error = new Error('network_error'); error.publicMessage = 'เชื่อมต่อ Panthorium ไม่ได้ กรุณาตรวจสอบอินเทอร์เน็ตแล้วลองใหม่'; throw error;
    }
    let data;
    try { data = await response.json(); } catch (_) { data = {}; }
    if (!response.ok || data.ok === false) {
      const error = new Error(String(data.error || 'request_failed'));
      error.code = data.error; error.status = response.status; throw error;
    }
    return data;
  }
  async function request(path, options = {}) {
    const generation = authGeneration;
    if (!token) throw new Error('not_authenticated');
    try {
      const data = await rawRequest(path, { ...options, headers:{ ...(options.headers || {}), Authorization:'Bearer ' + token } });
      if (generation !== authGeneration) throw new Error('account_changed');
      return data;
    } catch (error) {
      if (generation === authGeneration && error.status === 401) requireLogin('เซสชันหมดอายุ กรุณาเข้าสู่ระบบอีกครั้ง');
      throw error;
    }
  }
  function acceptSession(session) {
    if (typeof session.accessToken !== 'string' || !session.accessToken || !session.user || session.user.roles?.includes('guest')) throw new Error('registered_account_required');
    token = session.accessToken; user = session.user; authGeneration++;
    $('account-name').textContent = user.displayName || user.username || user.email || user.id || user.sub || 'บัญชีของคุณ';
    $('account-panel').hidden = false;
    $('login-panel').hidden = true;
    $('password').value = '';
  }
  async function loadConsent() {
    consent = await request('/oauth/request');
    if (!consent.requestId || !consent.csrfToken) throw new Error('invalid_request');
    $('client-name').textContent = consent.clientName || consent.client?.client_name || 'ChatGPT';
    $('scope-list').replaceChildren();
    for (const scope of scopes(consent.scopes)) {
      const li = document.createElement('li'), name = document.createElement('span'), description = document.createElement('span');
      name.className = 'scope-name'; name.textContent = scope;
      description.className = 'scope-description'; description.textContent = scopeDescriptions[scope] || 'อนุญาตใช้ความสามารถนี้ภายในสิทธิ์เดิมของบัญชี Panthorium';
      li.append(name, description); $('scope-list').append(li);
    }
    $('consent-expiry').textContent = 'คำขอนี้ใช้ได้ถึง ' + expiry(consent.expiresAt);
    $('consent-panel').hidden = false;
    showStatus('');
  }
  async function authorize(approve) {
    if (busy || !consent) return;
    setBusy(true); showStatus(approve ? 'กำลังเชื่อมบัญชี…' : 'กำลังปฏิเสธคำขอ…');
    try {
      const result = await request('/oauth/authorize', { method:'POST', body:JSON.stringify({ requestId:consent.requestId, csrfToken:consent.csrfToken, approve }) });
      const redirect = new URL(result.redirectUrl);
      // The redirect is obtained only from the authenticated server response, never from query parameters.
      if (redirect.protocol !== 'https:' || redirect.username || redirect.password) throw new Error('invalid_redirect');
      token = null; consent = null;
      showStatus(approve ? 'เชื่อมบัญชีแล้ว กำลังกลับไปยัง ChatGPT…' : 'ปฏิเสธคำขอแล้ว กำลังกลับไปยัง ChatGPT…', 'success');
      location.assign(redirect.href);
    } catch (error) { showStatus(errorMessage(error), 'error'); setBusy(false); }
  }
  function renderAction() {
    $('action-description').textContent = action.description || 'ตรวจสอบรายละเอียดของคำสั่งก่อนยืนยัน';
    $('action-tool').textContent = action.toolId;
    $('action-state').textContent = stateLabels[action.state] || action.state || 'ไม่ทราบสถานะ';
    $('action-risk').textContent = ({low:'ต่ำ',medium:'ปานกลาง',high:'สูง',critical:'สูงมาก'})[action.risk] || action.risk || 'ไม่ระบุ';
    $('action-expiry').textContent = expiry(action.approvalExpiresAt);
    $('action-args').textContent = JSON.stringify(action.args || {}, null, 2);
    $('paid-notice').hidden = !paidTools.has(action.toolId);
    const pending = action.state === 'awaiting_confirmation' || action.state === 'proposed';
    const expired = !Number.isFinite(Date.parse(action.approvalExpiresAt)) || Date.parse(action.approvalExpiresAt) <= Date.now();
    const canApprove = canApproveAction();
    $('action-buttons').hidden = !pending;
    $('confirm-action').disabled = busy || !canApprove;
    $('cancel-action').disabled = busy || !pending;
    $('confirm-action').textContent = paidTools.has(action.toolId) ? 'ยืนยันใช้บริการที่มีค่าใช้จ่าย' : 'ยืนยันคำสั่งนี้';
    $('action-followup').hidden = pending;
    $('action-followup').textContent = action.state === 'running' ? 'คำสั่งเริ่มทำงานแล้ว คุณกลับไปให้ ChatGPT ตรวจสอบผลต่อได้' : action.state === 'unknown' ? 'ยังยืนยันผลไม่ได้ กรุณาตรวจสอบใน Panthorium ก่อนสั่งซ้ำ เพื่อหลีกเลี่ยงการทำงานหรือคิดค่าบริการซ้ำ' : 'กลับไปที่ ChatGPT เพื่อดูผลและดำเนินงานต่อได้';
    $('action-panel').hidden = false;
    if (pending && expired) showStatus(errors.action_confirmation_expired, 'error');
    else showStatus('');
  }
  async function loadAction() {
    if (!uuid.test(actionId || '')) { const error = new Error('invalid_action'); error.publicMessage = 'ลิงก์คำสั่งไม่ถูกต้อง กรุณาเปิดลิงก์ใหม่จาก ChatGPT'; throw error; }
    const result = await request('/api/actions/' + encodeURIComponent(actionId));
    if (!result.action || result.action.actionId !== actionId) throw new Error('invalid_action');
    action = result.action;
    renderAction();
    clearTimeout(timer);
    if (action.state === 'running') timer = setTimeout(() => loadAction().catch(error => showStatus(errorMessage(error), 'error')), 4000);
  }
  async function handleAction(confirm) {
    if (busy || !action) return;
    if (confirm && !canApproveAction()) { showStatus(errors.action_confirmation_expired, 'error'); return; }
    setBusy(true); clearTimeout(timer);
    showStatus(confirm ? 'ยืนยันแล้ว กำลังดำเนินการ…' : 'กำลังยกเลิกคำสั่ง…');
    try {
      await request('/api/actions/' + encodeURIComponent(actionId) + (confirm ? '/confirm' : '/cancel'), { method:'POST', body:JSON.stringify(confirm ? { approvalHash:action.approvalHash } : {}) });
      setBusy(false);
      await loadAction();
    } catch (error) {
      setBusy(false);
      // Never automatically repeat a confirmation after a network failure or unknown outcome.
      if (token) { try { await loadAction(); } catch (_) {} }
      showStatus(errorMessage(error), 'error');
    }
  }
  async function loadGrants() {
    const result = await request('/oauth/grants');
    $('grants-list').replaceChildren();
    const grants = Array.isArray(result.grants) ? result.grants : [];
    if (!grants.length) { const p = document.createElement('p'); p.className = 'small muted'; p.textContent = 'ยังไม่มีการเชื่อมต่อที่ใช้งานอยู่'; $('grants-list').append(p); }
    for (const grant of grants) {
      const article = document.createElement('article'), header = document.createElement('div'), info = document.createElement('div'), title = document.createElement('h3'), detail = document.createElement('p'), dates = document.createElement('p'), button = document.createElement('button');
      article.className = 'grant'; header.className = 'grant-header';
      title.textContent = grant.clientName || 'ChatGPT'; detail.className = 'small muted'; detail.textContent = scopes(grant.scopes).join(' · ');
      dates.className = 'small muted'; dates.textContent = 'เชื่อมเมื่อ ' + expiry(grant.createdAt) + (grant.expiresAt ? ' · หมดอายุ ' + expiry(grant.expiresAt) : '');
      button.className = 'text-button'; button.type = 'button'; button.textContent = 'ยกเลิกการเชื่อมต่อ';
      const confirmation = document.createElement('div'), prompt = document.createElement('p'), buttons = document.createElement('div'), yes = document.createElement('button'), no = document.createElement('button');
      confirmation.className = 'revoke-confirm'; confirmation.hidden = true;
      prompt.className = 'small'; prompt.textContent = 'ยกเลิกสิทธิ์ของการเชื่อมต่อนี้? หากต้องการใช้อีกครั้ง คุณสามารถเชื่อมบัญชีใหม่ได้';
      buttons.className = 'actions'; yes.className = 'button'; yes.type = 'button'; yes.textContent = 'ยืนยันการยกเลิก'; no.className = 'button'; no.type = 'button'; no.textContent = 'เก็บไว้';
      button.addEventListener('click', () => { confirmation.hidden = false; button.hidden = true; yes.focus(); });
      no.addEventListener('click', () => { confirmation.hidden = true; button.hidden = false; button.focus(); });
      yes.addEventListener('click', async () => {
        if (yes.disabled) return;
        yes.disabled = true; no.disabled = true;
        try { await request('/oauth/grants/' + encodeURIComponent(grant.grantId), { method:'DELETE' }); await loadGrants(); showStatus('ยกเลิกการเชื่อมต่อแล้ว', 'success'); }
        catch (error) { showStatus(errorMessage(error), 'error'); yes.disabled = false; no.disabled = false; }
      });
      buttons.append(yes, no); confirmation.append(prompt, buttons);
      info.append(title, detail, dates); header.append(info, button); article.append(header, confirmation); $('grants-list').append(article);
    }
    $('grants-panel').hidden = false;
  }
  async function loadMode() {
    if (mode === 'consent') return loadConsent();
    if (mode === 'action') return loadAction();
    await loadGrants(); showStatus('');
  }
  $('login-form').addEventListener('submit', async event => {
    event.preventDefault();
    if (busy) return;
    setBusy(true); showStatus('กำลังเข้าสู่ระบบ…');
    try {
      const session = await rawRequest('/api/auth/login', { method:'POST', body:JSON.stringify({ username:$('username').value.trim(), password:$('password').value, rememberMe:false }) });
      acceptSession(session); await loadMode();
    } catch (error) { showStatus(errorMessage(error), 'error'); }
    finally { $('password').value = ''; setBusy(false); }
  });
  $('switch-account').addEventListener('click', async () => {
    if (busy) return;
    setBusy(true);
    try { await rawRequest('/api/auth/logout', { method:'POST', body:'{}' }); requireLogin('เข้าสู่ระบบด้วยบัญชีที่ต้องการเชื่อมต่อ'); $('username').focus(); }
    catch (error) { showStatus(errorMessage(error), 'error'); }
    finally { setBusy(false); }
  });
  $('allow-button').addEventListener('click', () => authorize(true));
  $('deny-button').addEventListener('click', () => authorize(false));
  $('confirm-action').addEventListener('click', () => handleAction(true));
  $('cancel-action').addEventListener('click', () => handleAction(false));
  $('refresh-grants').addEventListener('click', async () => { if (busy) return; setBusy(true); try { await loadGrants(); showStatus(''); } catch (error) { showStatus(errorMessage(error), 'error'); } finally { setBusy(false); } });
  $('copy-endpoint').addEventListener('click', async () => {
    try { await navigator.clipboard.writeText(location.origin + '/mcp'); $('copy-endpoint').textContent = 'คัดลอกแล้ว'; }
    catch (_) { showStatus('คัดลอกอัตโนมัติไม่ได้ คุณเลือกและคัดลอก URL ด้านบนได้'); }
  });
  window.addEventListener('pagehide', () => { token = null; consent = null; action = null; clearTimeout(timer); authGeneration++; });
  window.addEventListener('pageshow', event => { if (event.persisted) location.reload(); });
  async function init() {
    if (mode === 'consent') { $('page-title').textContent = 'เชื่อมบัญชี Panthorium'; $('page-intro').textContent = 'ตรวจสอบบัญชีและสิทธิ์ที่ ChatGPT ขอใช้ก่อนอนุญาตการเชื่อมต่อ'; }
    if (mode === 'action') { $('page-title').textContent = 'คุณเป็นผู้ยืนยันคำสั่ง'; $('page-intro').textContent = 'ตรวจสอบรายละเอียดด้านล่างก่อนให้ Panthorium ดำเนินงานที่ ChatGPT เสนอ'; }
    if (mode === 'connections') { $('setup-panel').hidden = false; $('mcp-endpoint').textContent = location.origin + '/mcp'; }
    try {
      const session = await rawRequest('/api/auth/refresh', { method:'POST', body:'{}' }); acceptSession(session); await loadMode();
    } catch (error) {
      if (!token) requireLogin(error.status === 401 ? undefined : errorMessage(error));
      else showStatus(errorMessage(error), 'error');
    }
  }
  init();
}());
