/* Browser surface for organization Cloud APIs. No local workspace or offline queue. */
(function () {
  'use strict';
  const ID = 'organizations';
  const os = () => typeof OS !== 'undefined' ? OS : null;
  const principal = () => String(os()?.state?.user?.sub || os()?.state?.user?.id || '');
  const signedIn = () => !!principal() && !/^guest[:_-]/i.test(principal()) && !(os()?.state?.user?.roles || []).includes('guest');
  const profiles = () => window.PanthoriumOrganizationCatalog?.profiles || [];
  const tabs = [['overview', 'ภาพรวม'], ['members', 'สมาชิก'], ['teams', 'ทีม'], ['resources', 'งานร่วมกัน'], ['approvals', 'คำขอเข้าถึง'], ['audit', 'บันทึกเหตุการณ์']];
  const roles = ['owner', 'admin', 'manager', 'member', 'viewer', 'auditor', 'guest'];
  const classifications = ['public', 'internal', 'confidential', 'restricted'];
  const encode = encodeURIComponent;
  let view = null, generation = 0, lastIdentity = '', observer = null;
  function identity() { return JSON.stringify([principal(), [...(os()?.state?.user?.roles || [])].sort(), [...(os()?.state?.user?.permissions || [])].sort()]); }
  const el = (tag, text, attrs = {}) => { const node = document.createElement(tag); if (text != null) node.textContent = text; for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, value); return node; };
  const button = (text, handler, attrs = {}) => { const node = el('button', text, { type: 'button', ...attrs }); node.onclick = handler; return node; };
  const ids = value => String(value || '').split(',').map(item => item.trim()).filter(Boolean);
  const current = v => view === v && v.root.isConnected && v.owner === principal() && v.generation === generation && signedIn();
  const scope = v => ({ orgId: v.org?.id, revision: v.revision });
  const same = (v, captured) => current(v) && v.org?.id === captured.orgId && v.revision === captured.revision;
  const endpoint = (v, suffix = '') => '/' + encode(v.org.id) + suffix;
  function status(v, text) { if (current(v)) v.root.querySelector('[data-org-status]').textContent = text; }
  function friendly(error) { return error.status === 403 ? 'ไม่มีสิทธิ์ทำรายการนี้ในองค์กร' : error.status === 409 ? 'ข้อมูลเปลี่ยนแล้วหรือขัดกับนโยบาย • รีเฟรชแล้วตรวจรายการก่อนทำใหม่' : error.status === 401 ? 'เซสชันหมดอายุ • ลงชื่อเข้าใช้อีกครั้ง' : error.message === 'offline' ? 'ไม่ได้เชื่อมต่อ Cloud • ไม่มีการทำงานออฟไลน์' : 'ทำรายการไม่สำเร็จ • ตรวจข้อมูลและการเชื่อมต่อก่อนลองอีกครั้ง'; }
  async function api(path, options = {}, raw = false) {
    const owner = principal(), epoch = generation;
    const valid = () => signedIn() && principal() === owner && generation === epoch;
    if (!valid()) throw Error('account_changed');
    if (navigator.onLine === false) throw Error('offline');
    const send = () => {
      if (!valid()) throw Error('account_changed');
      return fetch(String(os()?.config?.backendUrl || '').replace(/\/$/, '') + '/api/organizations' + path, { ...options, credentials: 'include', headers: { ...(os()?.config?.accessToken ? { Authorization: 'Bearer ' + os().config.accessToken } : {}), ...(options.body ? { 'Content-Type': 'application/json' } : {}), ...(options.headers || {}) } });
    };
    let response = await send();
    if (response.status === 401 && valid() && window.PanthoriumAuth?.refreshSession && await window.PanthoriumAuth.refreshSession().catch(() => false)) response = await send();
    if (!valid()) throw Error('account_changed');
    if (raw && response.ok) return response;
    const data = await response.json().catch(() => ({}));
    if (!valid()) throw Error('account_changed');
    if (!response.ok || data.ok === false) { const error = Error(data.error || 'unavailable'); error.status = response.status; throw error; }
    return data;
  }
  const post = (path, body) => api(path, { method: 'POST', body: JSON.stringify(body) });
  const patch = (path, body) => api(path, { method: 'PATCH', body: JSON.stringify(body) });
  function field(parent, title, name, type = 'text', value = '', choices = []) {
    const label = el('label', title); const node = el(type === 'textarea' ? 'textarea' : type === 'select' ? 'select' : 'input', null, { 'data-field': name, 'aria-label': title });
    if (type === 'select') for (const choice of choices) node.append(el('option', typeof choice === 'string' ? choice : choice.label, { value: typeof choice === 'string' ? choice : choice.value }));
    else if (type === 'textarea') node.rows = 4;
    else node.type = type;
    if (type === 'checkbox') { node.checked = value === true; label.className = 'org-checkbox'; }
    else node.value = value == null ? '' : String(value);
    label.append(node); parent.append(label); return node;
  }
  const value = (form, name) => form.querySelector('[data-field="' + name + '"]').value.trim();
  const checked = (form, name) => form.querySelector('[data-field="' + name + '"]').checked;
  const selected = (form, name) => Array.from(form.querySelector('[data-field="' + name + '"]').selectedOptions, option => option.value);
  const rosterChoices = members => members.map(member => ({ value: member.userId, label: (member.displayName || member.email || member.userId) + ' · ' + member.role + (member.status === 'active' ? '' : ' · ' + member.status) }));
  const localDate = iso => { const date = new Date(iso); return Number.isFinite(date.getTime()) ? new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16) : ''; };
  function picker(parent, title, name, choices, values = []) {
    const all = choices.map(choice => typeof choice === 'string' ? { value: choice, label: choice } : choice);
    for (const id of values) if (!all.some(choice => choice.value === id)) all.push({ value: id, label: id + ' · ตรวจสอบสิทธิ์อีกครั้ง' });
    const node = field(parent, title, name, 'select', '', all); node.multiple = true; node.size = Math.min(5, Math.max(2, all.length));
    for (const option of node.options) option.selected = values.includes(option.value);
    return node;
  }
  function grantLabels(v) { return (v.org.compartmentCatalog || []).filter(label => (v.membership.compartments || []).includes(label)); }
  function grantClearance(v) { return classifications.slice(0, Math.max(1, classifications.indexOf(v.membership.clearance) + 1)); }
  function form(parent, title, submitLabel, submit) {
    const section = el('section', null, { 'data-pt-card': '' }); if (title) section.append(el('h3', title));
    const node = el('form'); section.append(node); parent.append(section);
    const actions = el('div', null, { class: 'org-actions' }); const save = el('button', submitLabel, { type: 'submit' }); actions.append(save); section.append(actions);
    // Button belongs to its form, while fields can be appended afterwards.
    node.append(actions);
    node.onsubmit = async event => { event.preventDefault(); if (save.disabled) return; save.disabled = true; try { await submit(node, save); } finally { if (node.isConnected) save.disabled = false; } };
    return node;
  }
  function notice(parent, text) { parent.append(el('p', text, { class: 'org-muted' })); }
  function markup() {
    return `<div data-organizations><style>
      [data-organizations]{height:100%;overflow:auto;padding:18px;color:var(--text);font-size:14px;line-height:1.55}
      [data-organizations] *{box-sizing:border-box}[data-organizations] [hidden]{display:none!important}
      [data-organizations] h2{font-size:24px;margin:4px 0 10px}[data-organizations] h3{margin:4px 0 12px}
      [data-organizations] p{margin:8px 0}[data-organizations] .org-muted{color:var(--text-dim);font-size:12px}
      [data-organizations] label{display:grid;gap:5px;margin:10px 0}[data-organizations] .org-checkbox{display:flex;align-items:center;gap:8px}
      [data-organizations] input:not([type=checkbox]),[data-organizations] textarea,[data-organizations] select{width:100%;padding:10px;font:inherit}
      [data-organizations] textarea{resize:vertical}[data-organizations] button{padding:9px 12px;font:inherit;cursor:pointer}
      [data-organizations] [data-pt-card]{padding:16px;margin:12px 0}[data-organizations] .org-actions,[data-organizations] nav{display:flex;gap:8px;flex-wrap:wrap;margin:12px 0}
      [data-organizations] form{display:flex;flex-direction:column}[data-organizations] form>.org-actions{order:10}
      [data-organizations] .org-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:12px}
      [data-organizations] .org-list{display:grid;gap:8px}[data-organizations] .org-list>button{text-align:left}
      [data-organizations] pre{white-space:pre-wrap;overflow-wrap:anywhere;font:inherit}[data-organizations] [data-org-status]{color:var(--pt-cyan,var(--accent));white-space:pre-wrap}
      @media(max-width:650px){[data-organizations]{padding:12px}[data-organizations] .org-grid{grid-template-columns:1fr}}
    </style><header><small>ORGANIZATION WORKSPACE</small><h2>องค์กรและทีม</h2><p class="org-muted">พื้นที่องค์กรที่มีการแบ่งปันตามสิทธิ์ แยกจากบริบท “งานของฉัน” ซึ่งเป็นข้อมูลส่วนตัว</p></header>
    <label>องค์กรที่ใช้งาน<select data-org-switch aria-label="เลือกองค์กร"></select></label><div class="org-actions"><button type="button" data-org-create>สร้างองค์กร</button><button type="button" data-org-join>เข้าร่วมด้วยรหัสเชิญ</button><button type="button" data-org-refresh>รีเฟรช</button></div>
    <p data-org-status role="status" aria-live="polite"></p><nav data-org-tabs aria-label="เมนูองค์กร"></nav><main data-org-main></main></div>`;
  }
  async function organizations(v, selectedId) {
    const revision = ++v.revision;
    try {
      const data = await api(''); if (!current(v) || v.revision !== revision) return;
      v.list = data.organizations || []; v.readiness = data.readiness || {};
      const select = v.root.querySelector('[data-org-switch]'); select.replaceChildren();
      for (const entry of v.list) select.append(el('option', entry.organization.name, { value: entry.organization.id }));
      if (!v.list.length) { select.append(el('option', 'ยังไม่มีองค์กร', { value: '' })); v.org = null; createOrganization(v); return; }
      await chooseOrganization(v, selectedId && v.list.some(entry => entry.organization.id === selectedId) ? selectedId : v.list[0].organization.id);
    } catch (error) { if (current(v) && v.revision === revision) status(v, friendly(error)); }
  }
  async function chooseOrganization(v, orgId) {
    const revision = ++v.revision; v.org = null; v.root.querySelector('[data-org-main]').replaceChildren(); v.root.querySelector('[data-org-tabs]').replaceChildren();
    status(v, 'กำลังโหลดขอบเขตองค์กร…');
    try {
      const data = await api('/' + encode(orgId)); if (!current(v) || v.revision !== revision) return;
      v.org = data.organization; v.membership = data.membership; v.capabilities = data.capabilities || {};
      v.root.querySelector('[data-org-switch]').value = orgId; renderTab(v, 'overview');
    } catch (error) { if (current(v) && v.revision === revision) status(v, friendly(error)); }
  }
  function createOrganization(v, profile) {
    ++v.revision; const main = v.root.querySelector('[data-org-main]'); main.replaceChildren(); v.root.querySelector('[data-org-tabs]').replaceChildren(); const captured = scope(v);
    const f = form(main, 'สร้างพื้นที่องค์กร', 'สร้างองค์กรบน Cloud', async form => {
      try { const data = await post('', { name: value(form, 'name'), profile: value(form, 'profile'), compartments: ids(value(form, 'compartments')) }); if (same(v, captured)) await organizations(v, data.organization.id); }
      catch (error) { if (same(v, captured)) status(v, friendly(error)); }
    });
    field(f, 'ชื่อองค์กร', 'name').required = true;
    field(f, 'โปรไฟล์องค์กร', 'profile', 'select', profile || v.preferredProfile || 'micro', profiles().map(item => ({ value: item.id, label: item.name + ' · ' + item.label })));
    field(f, 'ขอบเขตข้อมูลขององค์กร (ไม่บังคับ เช่น finance, hr)', 'compartments');
    notice(f, 'รหัสขอบเขตใช้ตัวอักษรอังกฤษ ตัวเลข _ หรือ - คั่นด้วยจุลภาค กำหนดครั้งเดียวตอนสร้างองค์กร ไม่ได้เป็นการรับรองความปลอดภัย');
    notice(f, 'สร้างโครงสร้างพื้นที่เท่านั้น ไม่ใช่การซื้อแพ็กหรือเปิดสิทธิ์สัญญา AI ปิดโดยค่าเริ่มต้น และต้องเปิดตามนโยบายทั้งองค์กรและทรัพยากรก่อนใช้');
    status(v, 'ยังไม่มีการเรียกเก็บเงิน • ข้อมูลและงานประมวลผลบน Cloud');
  }
  function joinOrganization(v) {
    ++v.revision; const main = v.root.querySelector('[data-org-main]'); main.replaceChildren(); v.root.querySelector('[data-org-tabs]').replaceChildren(); const captured = scope(v);
    const f = form(main, 'เข้าร่วมด้วยคำเชิญ', 'ยอมรับคำเชิญ', async form => {
      try { const data = await post('/invitations/accept', { token: value(form, 'token') }); if (same(v, captured)) await organizations(v, data.organization.id); }
      catch (error) { if (same(v, captured)) status(v, friendly(error)); }
    }); field(f, 'รหัสเชิญจากผู้ดูแลองค์กร', 'token', 'textarea').required = true;
    notice(f, 'ตรวจชื่อผู้เชิญจากช่องทางที่เชื่อถือได้ รหัสเชิญอาจใช้ได้เฉพาะอีเมลที่กำหนด');
  }
  function renderTab(v, tab) {
    if (!current(v) || !v.org) return; ++v.revision; v.tab = tab;
    const nav = v.root.querySelector('[data-org-tabs]'); nav.replaceChildren();
    for (const [id, title] of tabs) { if (id === 'audit' && !v.capabilities.viewAudit) continue; nav.append(button(title, () => renderTab(v, id), { 'aria-pressed': String(id === tab), 'data-org-tab': id })); }
    const main = v.root.querySelector('[data-org-main]'); main.replaceChildren();
    status(v, v.org.name + ' · ' + (v.membership?.role || '') + ' · สิทธิ์เนื้อหาตรวจแยกเป็นรายรายการ');
    ({ overview, members, teams, resources, approvals, audit }[tab] || overview)(v, main, scope(v));
  }
  function overview(v, main, captured) {
    const section = el('section', null, { 'data-pt-card': '' }); section.append(el('h3', v.org.name), el('p', 'โปรไฟล์ ' + v.org.profile), el('p', 'บทบาทของคุณ: ' + (v.membership?.role || '')));
    notice(section, 'ผู้ดูแลองค์กรไม่ได้มีสิทธิ์อ่านข้อความส่วนตัวของสมาชิกโดยอัตโนมัติ สิทธิ์สมาชิก นโยบายองค์กร และสิทธิ์ทรัพยากรถูกตรวจร่วมกัน');
    notice(section, 'พูด “เปิดองค์กร” เพื่อเปิดหน้าต่างนี้ การอ่านข้อมูลหรือทำรายการองค์กรยังต้องใช้ปุ่มในหน้าต่าง');
    notice(section, 'SSO, SCIM และ SIEM ยังไม่เชื่อมต่อ ไม่มีการอ้างใบรับรองความปลอดภัยจากการเลือกโปรไฟล์'); main.append(section);
    const limits = v.readiness?.pilotLimits;
    notice(section, 'ทั้งห้าโปรไฟล์ยังอยู่ในขอบเขตรุ่นทดลองเดียวกัน' + (limits ? ' • สูงสุด ' + limits.members + ' สมาชิก และ ' + limits.teams + ' ทีมต่อองค์กร' : '') + ' • โปรไฟล์ Security ปิด AI');
    if (!v.capabilities.managePolicy) return;
    const f = form(main, 'ตั้งค่านโยบายองค์กร', 'บันทึกนโยบาย', async form => {
      try {
        const data = await patch(endpoint(v), { name: value(form, 'name'), version: v.org.version, policy: { aiEnabled: checked(form, 'aiEnabled'), exportEnabled: checked(form, 'exportEnabled'), allowExternalGuests: checked(form, 'allowExternalGuests'), maxAiClassification: value(form, 'maxAiClassification') } });
        if (same(v, captured)) { v.org = data.organization; renderTab(v, 'overview'); status(v, 'บันทึกนโยบายองค์กรแล้ว'); }
      } catch (error) { if (same(v, captured)) status(v, friendly(error)); }
    });
    field(f, 'ชื่อองค์กร', 'name', 'text', v.org.name).required = true;
    field(f, 'เปิด AI ตามสิทธิ์รายทรัพยากร', 'aiEnabled', 'checkbox', v.org.profile !== 'security' && v.org.policy?.aiEnabled).disabled = v.org.profile === 'security';
    field(f, 'อนุญาตส่งออกตามสิทธิ์รายทรัพยากร', 'exportEnabled', 'checkbox', v.org.policy?.exportEnabled);
    field(f, 'อนุญาตสมาชิกภายนอกตามนโยบาย', 'allowExternalGuests', 'checkbox', v.org.policy?.allowExternalGuests);
    field(f, 'ชั้นข้อมูลสูงสุดสำหรับ AI', 'maxAiClassification', 'select', v.org.policy?.maxAiClassification === 'public' ? 'public' : 'internal', ['public', 'internal']);
    notice(f, 'การเปิด AI ที่ระดับองค์กรไม่ได้เปิดให้ทุกไฟล์ ต้องอนุญาตที่ทรัพยากรด้วย โปรไฟล์ Security ไม่อนุญาต AI');
  }
  async function members(v, main, captured) {
    try {
      const data = await api(endpoint(v, '/members')); if (!same(v, captured)) return;
      for (const member of data.members || []) {
        const card = el('section', null, { 'data-pt-card': '', 'data-member-id': member.userId }); card.append(el('strong', member.displayName || member.email || member.userId), el('p', (member.role || '') + ' · ' + (member.status || ''))); main.append(card);
        if (member.userId === principal()) notice(card, 'บัญชีของคุณ • ไม่สามารถเปลี่ยนสิทธิ์ของตนเองจากหน้านี้');
        if (v.capabilities.manageMembers && member.userId !== principal() && (member.role !== 'owner' || v.membership.role === 'owner')) {
          const f = form(card, '', 'บันทึกสมาชิก', async form => {
            try { await patch(endpoint(v, '/members/' + encode(member.userId)), { role: value(form, 'role'), status: value(form, 'status'), clearance: value(form, 'clearance'), compartments: selected(form, 'compartments'), version: member.version }); if (same(v, captured)) renderTab(v, 'members'); }
            catch (error) { if (same(v, captured)) status(v, friendly(error)); }
          });
          field(f, 'บทบาท', 'role', 'select', member.role, roles.filter(role => role !== 'owner' || v.membership.role === 'owner'));
          field(f, 'สถานะ', 'status', 'select', member.status || 'active', ['active', 'suspended', 'revoked']);
          field(f, 'ระดับข้อมูล', 'clearance', 'select', member.clearance || 'internal', grantClearance(v));
          picker(f, 'ขอบเขตข้อมูลเพิ่มเติม', 'compartments', grantLabels(v), member.compartments || []);
        }
      }
      if (!v.capabilities.manageMembers) return;
      const f = form(main, 'สร้างคำเชิญ', 'สร้างรหัสเชิญ', async form => {
        try {
          const data = await post(endpoint(v, '/invitations'), { email: value(form, 'email'), role: value(form, 'role'), clearance: value(form, 'clearance'), compartments: selected(form, 'compartments') });
          if (!same(v, captured)) return;
          const receipt = el('section', null, { 'data-pt-card': '', 'data-invitation-receipt': '' }); receipt.append(el('p', 'สร้างคำเชิญแล้ว • ยังไม่ได้ส่งอีเมล'));
          const token = field(receipt, 'รหัสเชิญ • ส่งให้ผู้รับด้วยช่องทางของคุณ', 'invitationToken', 'textarea', data.token); token.readOnly = true;
          receipt.append(button('คัดลอกรหัสเชิญ', async () => { try { await navigator.clipboard.writeText(data.token); if (same(v, captured)) status(v, 'คัดลอกรหัสแล้ว • ยังไม่ได้ส่งให้ผู้รับ'); } catch (_) { if (same(v, captured)) status(v, 'คัดลอกอัตโนมัติไม่ได้ • เลือกรหัสแล้วคัดลอกเอง'); } }));
          if (data.invitation?.memberExpiresAt) notice(receipt, 'สิทธิ์สมาชิกจากคำเชิญนี้สิ้นสุด: ' + new Date(data.invitation.memberExpiresAt).toLocaleString('th-TH'));
          main.append(receipt); status(v, 'แสดงรหัสเชิญครั้งนี้เท่านั้น • ไม่มีการส่งข้อความอัตโนมัติ');
        } catch (error) { if (same(v, captured)) status(v, friendly(error)); }
      });
      field(f, 'อีเมลผู้รับคำเชิญ', 'email', 'email').required = true;
      field(f, 'บทบาท', 'role', 'select', 'member', roles.filter(role => role !== 'owner'));
      field(f, 'ระดับข้อมูล', 'clearance', 'select', 'internal', grantClearance(v));
      picker(f, 'ขอบเขตข้อมูลสำหรับผู้รับคำเชิญ', 'compartments', grantLabels(v));
    } catch (error) { if (same(v, captured)) status(v, friendly(error)); }
  }
  async function teams(v, main, captured) {
    try {
      const [data, roster] = await Promise.all([api(endpoint(v, '/teams')), api(endpoint(v, '/members'))]); if (!same(v, captured)) return;
      const all = data.teams || [];
      const choices = rosterChoices((roster.members || []).filter(member => member.status === 'active'));
      const editor = team => {
        const f = form(main, team ? team.name : 'สร้างทีม', team ? 'บันทึกทีม' : 'สร้างทีม', async form => {
          const body = { name: value(form, 'name'), memberIds: selected(form, 'memberIds') };
          if (v.capabilities.manageTeams) Object.assign(body, { parentId: value(form, 'parentId') || null, managerIds: selected(form, 'managerIds') });
          try { if (team) await patch(endpoint(v, '/teams/' + encode(team.id)), { ...body, version: team.version }); else await post(endpoint(v, '/teams'), body); if (same(v, captured)) renderTab(v, 'teams'); }
          catch (error) { if (same(v, captured)) status(v, friendly(error)); }
        });
        f.dataset.teamId = team?.id || 'new';
        field(f, 'ชื่อทีม', 'name', 'text', team?.name || '').required = true;
        picker(f, 'สมาชิกของทีม', 'memberIds', choices, team?.memberIds || []);
        if (v.capabilities.manageTeams) {
          field(f, 'ทีมแม่', 'parentId', 'select', team?.parentId || '', [{ value: '', label: 'ไม่มีทีมแม่' }, ...all.filter(t => t.id !== team?.id).map(t => ({ value: t.id, label: t.name }))]);
          picker(f, 'ผู้จัดการทีม (ต้องเป็นสมาชิกทีมด้วย)', 'managerIds', choices, team?.managerIds || []);
        }
        notice(f, 'เลือกได้หลายรายการ ทีมแม่ไม่ได้รับสิทธิ์เนื้อหาของทีมลูกอัตโนมัติ ผู้จัดการที่ได้รับมอบหมายแก้ได้เฉพาะชื่อและสมาชิกทีม');
      };
      for (const team of all) { if (v.capabilities.manageTeams || team.canManage === true) editor(team); else main.append(el('p', team.name)); }
      if (v.capabilities.manageTeams) editor(null);
    } catch (error) { if (same(v, captured)) status(v, friendly(error)); }
  }
  async function resources(v, main, captured, query = '', kind = '') {
    if (v.capabilities.createResource) main.append(button('สร้างเอกสาร / งาน / การตัดสินใจ', () => resourceEditor(v, main, null), { 'data-create-resource': '' }));
    const search = form(main, 'ค้นหางานที่คุณมีสิทธิ์เห็น', 'ค้นหา', form => { const query = value(form, 'query'), kind = value(form, 'kind'); ++v.revision; main.replaceChildren(); return resources(v, main, scope(v), query, kind); });
    field(search, 'ค้นชื่อรายการ', 'query', 'text', query).maxLength = 200;
    field(search, 'ประเภท', 'kind', 'select', kind, [{ value: '', label: 'ทุกประเภท' }, 'document', 'task', 'decision']);
    try {
      const data = await api(endpoint(v, '/resources') + '?limit=100&q=' + encode(query) + '&kind=' + encode(kind)); if (!same(v, captured)) return;
      const list = el('div', null, { class: 'org-list' }); main.append(list);
      notice(list, 'แสดงได้สูงสุด 100 รายการต่อการค้นหา');
      if (!(data.resources || []).length) notice(list, 'ยังไม่มีรายการที่คุณมีสิทธิ์เห็น');
      for (const resource of data.resources || []) list.append(button(resource.title + ' · ' + resource.kind + ' · v' + resource.version, () => resourceDetail(v, main, resource.id), { 'data-resource-id': resource.id }));
    } catch (error) { if (same(v, captured)) status(v, friendly(error)); }
  }
  async function resourceEditor(v, main, resource) {
    ++v.revision; main.replaceChildren(); const captured = scope(v), canShare = !resource || resource.capabilities?.share;
    let roster, teamList;
    try { const directory = await Promise.all([api(endpoint(v, '/members')), api(endpoint(v, '/teams'))]); if (!same(v, captured)) return; roster = rosterChoices((directory[0].members || []).filter(member => member.status === 'active')); teamList = (directory[1].teams || []).map(team => ({ value: team.id, label: team.name })); }
    catch (error) { if (same(v, captured)) status(v, friendly(error)); return; }
    main.append(button('← กลับรายการงาน', () => renderTab(v, 'resources')));
    const f = form(main, resource ? 'แก้ไข ' + resource.title : 'สร้างงานร่วมกัน', 'บันทึกบน Cloud', async form => {
      try {
        const kind = resource?.kind || value(form, 'kind');
        const body = { title: value(form, 'title'), body: value(form, 'body') };
        if (!resource) body.kind = kind;
        if (canShare) Object.assign(body, { visibility: value(form, 'visibility'), classification: value(form, 'classification'), teamIds: selected(form, 'teamIds'), readerIds: selected(form, 'readerIds'), editorIds: selected(form, 'editorIds'), compartments: selected(form, 'compartments'), inheritTeamAccess: checked(form, 'inheritTeamAccess'), aiAllowed: v.org.profile !== 'security' && checked(form, 'aiAllowed'), exportAllowed: checked(form, 'exportAllowed') });
        if (kind === 'task') Object.assign(body, { taskStatus: value(form, 'taskStatus'), assigneeIds: selected(form, 'assigneeIds'), dueAt: value(form, 'dueAt') ? new Date(value(form, 'dueAt')).toISOString() : null });
        if (kind === 'decision') body.decisionStatus = value(form, 'decisionStatus');
        const data = resource ? await patch(endpoint(v, '/resources/' + encode(resource.id)), { ...body, expectedVersion: resource.version }) : await post(endpoint(v, '/resources'), body); if (same(v, captured)) resourceDetail(v, main, data.resource.id);
      }
      catch (error) { if (same(v, captured)) status(v, friendly(error)); }
    });
    field(f, 'ชื่อเรื่อง', 'title', 'text', resource?.title || '').required = true;
    const kind = field(f, 'ประเภท', 'kind', 'select', resource?.kind || 'document', ['document', 'task', 'decision']);
    kind.disabled = !!resource;
    field(f, 'เนื้อหา', 'body', 'textarea', resource?.body || '');
    const task = el('div'); f.append(task); field(task, 'สถานะงาน', 'taskStatus', 'select', resource?.taskStatus || 'todo', ['todo', 'in_progress', 'blocked', 'done']); picker(task, 'ผู้รับผิดชอบ (ต้องมีสิทธิ์อ่าน)', 'assigneeIds', roster, resource?.assigneeIds || []); field(task, 'กำหนดส่ง (เวลาท้องถิ่นของอุปกรณ์)', 'dueAt', 'datetime-local', resource?.dueAt ? localDate(resource.dueAt) : '');
    const decision = el('div'); f.append(decision); field(decision, 'สถานะการตัดสินใจ', 'decisionStatus', 'select', resource?.decisionStatus || 'draft', ['draft', 'proposed', 'accepted']);
    const kinds = () => { task.hidden = kind.value !== 'task'; decision.hidden = kind.value !== 'decision'; }; kind.onchange = kinds; kinds();
    if (canShare) {
      field(f, 'ขอบเขตการมองเห็น', 'visibility', 'select', resource?.visibility || 'private', ['private', 'team', 'organization']);
      field(f, 'ชั้นข้อมูล', 'classification', 'select', resource?.classification || 'internal', ['public', 'internal', 'confidential']);
      picker(f, 'ทีมที่ได้รับสิทธิ์', 'teamIds', teamList, resource?.teamIds || []);
      picker(f, 'ผู้อ่านเพิ่มเติม', 'readerIds', roster, resource?.readerIds || []);
      picker(f, 'ผู้แก้ไขเพิ่มเติม', 'editorIds', roster, resource?.editorIds || []);
      picker(f, 'ขอบเขตข้อมูลเพิ่มเติม', 'compartments', grantLabels(v), resource?.compartments || []);
      field(f, 'สืบทอดสิทธิ์ทีมตามนโยบาย', 'inheritTeamAccess', 'checkbox', resource?.inheritTeamAccess);
      field(f, 'อนุญาต AI สำหรับรายการนี้', 'aiAllowed', 'checkbox', v.org.profile !== 'security' && resource?.aiAllowed).disabled = v.org.profile === 'security';
      field(f, 'อนุญาตส่งออกสำหรับรายการนี้', 'exportAllowed', 'checkbox', resource?.exportAllowed);
    }
    notice(f, 'ค่าเริ่มต้นเป็น private และปิด AI/ส่งออก สิทธิ์จริงยังขึ้นกับสมาชิกและนโยบายองค์กร ไม่อนุญาตสร้างชั้น restricted จากหน้าต่างนี้');
  }
  async function resourceDetail(v, main, id) {
    ++v.revision; main.replaceChildren(); const captured = scope(v);
    try {
      const data = await api(endpoint(v, '/resources/' + encode(id))); if (!same(v, captured)) return;
      const resource = data.resource, caps = resource.capabilities || {};
      main.append(button('← กลับรายการงาน', () => renderTab(v, 'resources')));
      const article = el('article', null, { 'data-pt-card': '', 'data-resource-detail': id });
      article.append(el('h3', resource.title), el('p', resource.kind + ' · v' + resource.version + ' · ' + resource.classification), el('pre', resource.body || '')); main.append(article);
      if (resource.kind === 'task') notice(article, 'สถานะ: ' + resource.taskStatus + ' · กำหนดส่ง: ' + (resource.dueAt ? new Date(resource.dueAt).toLocaleString('th-TH') : 'ไม่ระบุ'));
      if (resource.kind === 'decision') notice(article, 'สถานะ: ' + resource.decisionStatus);
      const actions = el('div', null, { class: 'org-actions' }); article.append(actions);
      if (caps.write) actions.append(button('แก้ไข', () => resourceEditor(v, main, resource), { 'data-edit-resource': '' }));
      actions.append(button('ดูประวัติรุ่น', async () => {
        try { const history = await api(endpoint(v, '/resources/' + encode(id) + '/revisions')); if (!same(v, captured)) return; const section = el('section', null, { 'data-pt-card': '' }); section.append(el('h3', 'ประวัติรุ่นล่าสุดที่คุณมีสิทธิ์อ่าน')); notice(section, 'แสดงจากประวัติรุ่นล่าสุดไม่เกิน ' + (history.viewLimit || 100) + ' รุ่น และตรวจสิทธิ์แต่ละรุ่น'); for (const item of history.revisions || []) section.append(el('h4', 'v' + item.resourceVersion + ' · ' + item.title), el('pre', item.body)); main.append(section); }
        catch (error) { if (same(v, captured)) status(v, friendly(error)); }
      }));
      if (caps.ai) actions.append(button('สรุปด้วย AI', async event => {
        const control = event.currentTarget; control.disabled = true;
        try { const result = await post(endpoint(v, '/resources/' + encode(id) + '/summarize'), { expectedVersion: resource.version }); if (!same(v, captured)) return; const section = el('section', null, { 'data-pt-card': '', 'data-org-summary': '' }); section.append(el('h3', 'ร่างสรุป · ต้องตรวจทาน'), el('pre', result.summary.text)); notice(section, 'จากรุ่น ' + result.summary.resourceVersion + ' • ไม่มีการส่งหรือแก้ไขระบบภายนอก'); if (window.PanthoriumPrivacyPolicy?.openAIReport) section.append(button('รายงานคำตอบ AI', () => window.PanthoriumPrivacyPolicy.openAIReport({ sourceType: 'general' }), { 'data-report-org-summary': '' })); main.append(section); }
        catch (error) { if (same(v, captured)) status(v, friendly(error)); }
        finally { if (same(v, captured)) control.disabled = false; }
      }, { 'data-ai-summary': '' })); else notice(article, 'AI ยังไม่อนุญาตสำหรับสิทธิ์หรือนโยบายของรายการนี้');
      if (caps.export) actions.append(button('ส่งออกสำเนา', async () => {
        try { const response = await api(endpoint(v, '/resources/' + encode(id) + '/export'), {}, true); const blob = await response.blob(); if (!same(v, captured)) return; const url = URL.createObjectURL(blob); const link = el('a', null, { href: url, download: 'panthorium-' + id + '.json' }); link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); status(v, 'ส่งออกสำเนาแล้ว • สิทธิ์สำเนานอกระบบต้องจัดการแยก'); }
        catch (error) { if (same(v, captured)) status(v, friendly(error)); }
      }));
      if (caps.delete) actions.append(button('เก็บรายการเข้าคลัง', async event => {
        const control = event.currentTarget; if (control.dataset.confirm !== 'true') { control.dataset.confirm = 'true'; control.textContent = 'ยืนยันเก็บเข้าคลัง'; return; }
        try { await api(endpoint(v, '/resources/' + encode(id)), { method: 'DELETE', body: JSON.stringify({ expectedVersion: resource.version }) }); if (same(v, captured)) renderTab(v, 'resources'); }
        catch (error) { if (same(v, captured)) status(v, friendly(error)); }
      }));
      const comments = await api(endpoint(v, '/resources/' + encode(id) + '/comments')); if (!same(v, captured)) return;
      const discussion = el('section', null, { 'data-pt-card': '' }); discussion.append(el('h3', 'ความคิดเห็น')); for (const comment of comments.comments || []) discussion.append(el('p', comment.authorId + ' · v' + comment.resourceVersion), el('pre', comment.body)); main.append(discussion);
      if (caps.comment) { const f = form(main, 'เพิ่มความคิดเห็น', 'บันทึกความคิดเห็น', async form => { try { await post(endpoint(v, '/resources/' + encode(id) + '/comments'), { body: value(form, 'body'), expectedVersion: resource.version }); if (same(v, captured)) resourceDetail(v, main, id); } catch (error) { if (same(v, captured)) status(v, friendly(error)); } }); field(f, 'ความคิดเห็น', 'body', 'textarea').required = true; }
    } catch (error) { if (same(v, captured)) status(v, friendly(error)); }
  }
  async function approvals(v, main, captured) {
    const f = form(main, 'ขอเข้าถึงรายการ', 'ส่งคำขอเข้าถึง', async form => {
      try { await post(endpoint(v, '/access-requests'), { resourceId: value(form, 'resourceId'), access: value(form, 'access'), reason: value(form, 'reason') }); if (same(v, captured)) { renderTab(v, 'approvals'); status(v, 'ส่งคำขอแล้ว • ยังไม่ยืนยันว่ามีสิทธิ์หรือมีรายการดังกล่าว'); } }
      catch (error) { if (same(v, captured)) status(v, friendly(error)); }
    }); field(f, 'รหัสรายการจากผู้ประสานงาน', 'resourceId').required = true; field(f, 'สิทธิ์ที่ขอ', 'access', 'select', 'read', ['read', 'write']); field(f, 'เหตุผล', 'reason', 'textarea').required = true;
    try {
      const data = await api(endpoint(v, '/access-requests')); if (!same(v, captured)) return;
      for (const request of data.requests || []) {
        const section = el('section', null, { 'data-pt-card': '', 'data-access-request': request.id }); section.append(el('strong', request.resourceId), el('p', request.access + ' · ' + request.status), el('p', request.reason || ''), el('small', request.requesterId ? 'ผู้ขอ: ' + request.requesterId : 'คำขอของคุณ'));
        if (request.expiresAt) notice(section, 'คำขอหมดอายุ: ' + new Date(request.expiresAt).toLocaleString('th-TH'));
        notice(section, 'หากอนุมัติ สิทธิ์คงอยู่จนกว่าจะถูกเพิกถอน' + (request.requiredApprovals ? ' • ต้องการผู้อนุมัติ ' + request.requiredApprovals + ' คน' : ''));
        for (const [action, label, permitted] of [['approve', 'อนุมัติ', request.canApprove], ['reject', 'ปฏิเสธ', request.canReject]]) if (permitted) section.append(button(label, async () => { try { await post(endpoint(v, '/access-requests/' + encode(request.id) + '/' + action), { expectedVersion: request.version }); if (same(v, captured)) renderTab(v, 'approvals'); } catch (error) { if (same(v, captured)) status(v, friendly(error)); } }));
        main.append(section);
      }
    } catch (error) { if (same(v, captured)) status(v, friendly(error)); }
  }
  async function audit(v, main, captured, cursor) {
    if (!v.capabilities.viewAudit) return notice(main, 'ไม่มีสิทธิ์อ่านบันทึกเหตุการณ์');
    if (!cursor) notice(main, 'บันทึกเหตุการณ์ล่าสุดที่คุณมีสิทธิ์ดู • โหลดครั้งละไม่เกิน 100 เหตุการณ์');
    try {
      const data = await api(endpoint(v, '/audit') + '?limit=100' + (cursor ? '&cursor=' + encode(cursor) : '')); if (!same(v, captured)) return;
      for (const event of data.events || []) { const card = el('section', null, { 'data-pt-card': '' }); card.append(el('strong', event.action || event.event || event.type || 'เหตุการณ์'), el('p', event.createdAt || event.at || ''), el('pre', JSON.stringify(event, null, 2))); main.append(card); }
      if (!data.events?.length) notice(main, 'ยังไม่มีเหตุการณ์ที่คุณมีสิทธิ์ดู');
      if (data.nextCursor) main.append(button('โหลดเหตุการณ์ก่อนหน้า', event => { event.currentTarget.remove(); audit(v, main, captured, data.nextCursor); }, { 'data-audit-more': '' }));
    }
    catch (error) { if (same(v, captured)) status(v, friendly(error)); }
  }
  async function open(options = {}) {
    if (!signedIn()) { window.PanthoriumAccounts?.openLogin?.(); return false; }
    if (view && current(view)) { window.PanthoriumWindowManager?.restore?.(ID); if (options.profile) { view.preferredProfile = options.profile; createOrganization(view, options.profile); } return true; }
    if (typeof createWindow !== 'function') return false;
    createWindow(ID, 'องค์กรและทีม', markup(), { width: 1080, height: 780 });
    const root = document.querySelector('.window[data-id="organizations"] [data-organizations]'); if (!root) return false;
    const v = view = { root, owner: principal(), generation, org: null, revision: 0, preferredProfile: options.profile };
    root.querySelector('[data-org-switch]').onchange = event => chooseOrganization(v, event.target.value);
    root.querySelector('[data-org-create]').onclick = () => createOrganization(v);
    root.querySelector('[data-org-join]').onclick = () => joinOrganization(v);
    root.querySelector('[data-org-refresh]').onclick = () => organizations(v, v.org?.id);
    await organizations(v); if (current(v) && options.profile) createOrganization(v, options.profile); return true;
  }
  function installMenu() {
    const menu = document.getElementById('sm-apps'); if (!menu) return;
    if (!signedIn()) { menu.querySelector('[data-start-group="organizations"]')?.remove(); return; }
    const group = window.PanthoriumStartMenuUI?.group?.('organizations', 'องค์กรและทีม', menu); if (!group) return;
    if (!group.querySelector('[data-app-id="organizations"]')) { const launcher = button('พื้นที่องค์กรและทีม', () => { open(); if (typeof closeStartMenu === 'function') closeStartMenu(); }, { class: 'sm-app', 'data-app-id': ID, 'data-search-text': 'องค์กรและทีม organizations teams shared workspace' }); launcher.style.cssText = 'width:100%;text-align:left'; group.append(launcher); }
    window.PanthoriumStartMenuUI.keepPinnedLast(menu);
    if (!observer && window.MutationObserver) { observer = new MutationObserver(installMenu); observer.observe(menu, { childList: true }); }
  }
  function authChanged() {
    const next = identity();
    if (next !== lastIdentity) { lastIdentity = next; generation++; if (view) view.root.replaceChildren(); if (typeof closeWindow === 'function') closeWindow(ID); else document.querySelector('.window[data-id="organizations"]')?.remove(); view = null; }
    installMenu();
  }
  lastIdentity = identity();
  window.PanthoriumOrganizations = Object.freeze({ open });
  for (const name of ['panthorium:auth-changed', 'panthorium:boot-complete', 'panthorium:apps-changed']) window.addEventListener(name, authChanged);
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', installMenu, { once: true }); else installMenu();
})();
