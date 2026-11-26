(function () {
  'use strict';
  const rules = window.PanthoriumBrief;
  if (!rules) return;
  function create({ slot, project, files, read, mutate, navigate, friendly }) {
    const el = (tag, value) => { const n = document.createElement(tag); if (value != null) n.textContent = value; return n; };
    const btn = (text, fn) => { const b = el('button', text); b.type = 'button'; b.onclick = fn; return b; };
    const opt = (value, text) => { const o = el('option', text); o.value = value; return o; };
    const label = (text, field) => { const l = el('label', text); l.append(field); return l; };
    const q = name => slot.querySelector('[data-b-' + name + ']');
    slot.innerHTML = `<details data-b-panel><summary><strong>บรีฟ งานเพิ่ม และข้อเสนอ</strong></summary>
      <fieldset data-b-controls><legend>ข้อตกลงของแฟ้มนี้</legend>
      <h3>บรีฟที่ตกลงแล้ว</h3><p data-b-pinned></p>
      <details data-b-edit><summary>กำหนดหรือเปลี่ยนบรีฟ</summary>
      <label>ข้อตกลงเดิม แยกหนึ่งข้อต่อบรรทัด<textarea data-b-baseline maxlength="8000"></textarea></label>
      <div class="wa-actions"><button type="button" data-b-from>นำข้อความต้นทางในแฟ้มมาใช้</button><button type="button" data-b-pin>ยืนยันบรีฟฉบับนี้</button></div><div data-b-file-controls hidden>
      <label>หรือเลือกไฟล์บรีฟที่แนบไว้<select data-b-file></select></label><button type="button" data-b-pin-file>ยืนยันบรีฟจากไฟล์นี้</button></div></details>
      <label>คำขอใหม่ของลูกค้า แยกหนึ่งเรื่องต่อบรรทัด<textarea data-b-request maxlength="4000" placeholder="เช่น ขอเพิ่มคลิปแนวตั้ง 3 คลิป"></textarea></label>
      <button type="button" data-b-compare>เทียบกับบรีฟที่ตกลงแล้ว</button>
      <div data-b-decisions></div>
      <h3>รายการที่ตรวจแล้ว</h3><label>เลือกคำขอที่บันทึก<select data-b-history></select></label><div data-b-detail></div>
      <div class="wa-actions"><button type="button" data-b-handover>บัตรส่งต่องาน · Life ขึ้นไป</button><button type="button" data-b-board>ข้อเสนอทุกแฟ้ม · Work Pro</button></div>
      <div data-b-board-list></div>
      <div data-b-result hidden><label>ข้อความพร้อมนำไปใช้ แก้ไขได้ก่อนคัดลอก<textarea data-b-output></textarea></label>
      <button type="button" data-b-copy>คัดลอกข้อความ</button></div></fieldset>
      <p role="status" aria-live="polite" data-b-status></p></details>`;
    let activeId, selectedId, previewId, locked = false, focusAfter, retry, membership, accessRequest, currentVersion;
    const states = new Map();
    function announce(message) { q('status').textContent = message; }
    function focus(node) { if (locked) focusAfter = node; else node.focus(); }
    function output(text) { q('result').hidden = false; q('output').value = text; focus(q('output')); }
    function clearPreview() { previewId = null; q('decisions').replaceChildren(); }
    function run(fn) {
      return async () => {
        if (locked) return;
        const id = activeId;
        locked = true; q('controls').disabled = true;
        try { await fn(); } catch (e) { if (id === activeId && slot.isConnected) announce(friendly(e)); }
        finally { locked = false; q('controls').disabled = false; if (focusAfter?.isConnected) focusAfter.focus(); focusAfter = null; }
      };
    }
    async function access(force = false) {
      if (membership && !force) return membership;
      if (!accessRequest) accessRequest = read('access').then(result => { membership = result.plan; return membership; }).finally(() => { accessRequest = null; });
      return accessRequest;
    }
    async function write(action, input) {
      const key = JSON.stringify([activeId, action, input]);
      if (retry?.key !== key) retry = { key, operationId: crypto.randomUUID() };
      const res = await mutate(action, input, retry.operationId);
      retry = null;
      return res.project;
    }
    const pinned = () => project()?.briefBaselines?.at(-1);
    const review = () => project()?.briefReviews?.find(i => i.id === selectedId);
    const original = r => project().briefBaselines.find(b => b.id === r.baselineId);
    function showHistory() {
      const records = project()?.briefReviews || [], history = q('history');
      history.replaceChildren();
      for (const r of [...records].reverse()) history.append(opt(r.id, r.rows[0].text + ' · บรีฟ ' + original(r).revision));
      if (!records.some(r => r.id === selectedId)) selectedId = records.at(-1)?.id;
      if (selectedId) history.value = selectedId;
      else history.append(opt('', 'ยังไม่มีคำขอที่บันทึก'));
      history.disabled = !records.length;
      renderDetail();
    }
    function quoteEditor(r) {
      const editor = el('div'), items = el('div');
      const add = (item = {}) => {
        const row = el('div'); row.className = 'wb-item';
        const name = el('input'), qty = el('input'), rate = el('input');
        name.value = item.label || ''; name.maxLength = 200; name.dataset.field = 'label';
        qty.type = 'number'; qty.min = '1'; qty.max = '999'; qty.value = item.quantity ?? '1'; qty.dataset.field = 'quantity';
        rate.type = 'text'; rate.inputMode = 'decimal'; rate.placeholder = '0.00'; rate.value = item.unitSatang == null ? '' : (item.unitSatang / 100).toFixed(2); rate.dataset.field = 'rate';
        row.append(label('รายการงานเพิ่ม', name), label('จำนวน', qty), label('บาทต่อหน่วย', rate), btn('ลบรายการ', () => row.remove())); items.append(row);
      };
      const initial = r.quote?.items || r.rows.filter(x => x.category === 'extra').map(x => ({ label: x.text }));
      for (const item of initial.length ? initial : [{}]) add(item);
      const delivery = el('input'); delivery.value = r.quote?.delivery || ''; delivery.maxLength = 100;
      editor.append(items, btn('เพิ่มรายการราคา', () => { if (items.children.length < 15) add(); else announce('ใส่ได้สูงสุด 15 รายการ'); }),
        label('กำหนดส่งที่เสนอ (ถ้าตกลงแล้ว)', delivery), btn('บันทึกข้อเสนอสองทางเลือก', run(async () => {
          const values = Array.from(items.children, row => ({ label: row.querySelector('[data-field="label"]').value.trim(), quantity: Number(row.querySelector('[data-field="quantity"]').value), unitPrice: row.querySelector('[data-field="rate"]').value.trim() }));
          await write('quotes', { reviewId: r.id, items: values, delivery: delivery.value.trim() });
          renderDetail(); q('board-list').replaceChildren(); output(rules.quoteText(review(), original(review()))); announce('บันทึกร่างข้อเสนอแล้ว');
        })));
      return editor;
    }
    function renderDetail() {
      const detail = q('detail'), r = review(); detail.replaceChildren(); if (!r) return;
      const baseline = original(r), terms = rules.lines(baseline.text);
      const old = el('details'); old.append(el('summary', 'ดูข้อตกลงอ้างอิง · ฉบับ ' + baseline.revision), el('pre', baseline.text)); if (baseline.source) old.append(el('small', 'ไฟล์ต้นทาง ' + baseline.source.name)); detail.append(old);
      const list = el('ul');
      for (const row of r.rows) list.append(el('li', rules.categories[row.category] + ' · ' + row.text + (row.evidence == null ? '' : ' — “' + terms[row.evidence] + '”')));
      detail.append(list, btn('เตรียมข้อความตอบลูกค้า', () => output(rules.replyText(r, baseline))));
      const quote = r.quote;
      if (quote) {
        detail.append(el('p', rules.statuses[quote.status] + ' · ยอดเพิ่ม ' + rules.money(quote.totalSatang)), btn('เปิดข้อความข้อเสนอ', () => output(rules.quoteText(r, baseline))));
      }
      if (!quote || quote.status === 'draft') {
        const edit = btn('เตรียมราคาสองทางเลือก · Work ขึ้นไป', run(async () => {
          if (rules.plans[await access(true)].level < 2) throw Error('brief_plan_required_work');
          edit.replaceWith(quoteEditor(r));
        }));
        detail.append(edit);
      }
      const next = quote?.status === 'draft' ? [['pending', 'บันทึกว่าส่งแล้ว รอลูกค้าตอบ']] : quote?.status === 'pending' ?
        [['accepted', 'บันทึกว่าลูกค้าตกลง'], ['declined', 'บันทึกว่าลูกค้าไม่รับ'], ['draft', 'กลับไปแก้ร่าง']] : [];
      for (const [status, text] of next) detail.append(btn(text, run(async () => {
        await write('status', { reviewId: r.id, status }); renderDetail(); q('board-list').replaceChildren(); announce('บันทึกสถานะแล้ว · ' + rules.statuses[status]);
      })));
    }
    function sources() {
      const select = q('file'), previous = select.value, choices = files();
      select.replaceChildren(...choices.map(file => opt(file.id, file.name)));
      if (choices.some(file => file.id === previous)) select.value = previous;
      q('file-controls').hidden = !choices.length;
    }
    function refresh() {
      const p = project(); if (!p) return;
      const switched = activeId !== p.id;
      if (switched && activeId) states.set(activeId, { baseline: q('baseline').value, request: q('request').value, selectedId });
      if (switched) {
        const previous = states.get(p.id) || {};
        activeId = p.id; selectedId = previous.selectedId;
        q('baseline').value = previous.baseline ?? (p.briefBaselines?.at(-1)?.text || '');
        q('request').value = previous.request || ''; q('result').hidden = true; q('output').value = ''; q('board-list').replaceChildren(); clearPreview(); announce('');
      }
      const b = pinned();
      if (previewId && previewId !== b?.id) { clearPreview(); announce('บรีฟเปลี่ยนแล้ว กรุณาเทียบคำขออีกครั้ง'); }
      q('pinned').textContent = b ? 'บรีฟฉบับ ' + b.revision + (b.source ? ' · ' + b.source.name : '') + '\n' + b.text : 'ใส่ข้อตกลงเดิมก่อนเทียบคำขอแรก';
      if (switched) q('edit').open = !b;
      if (switched || currentVersion !== p.version) showHistory();
      currentVersion = p.version;
    }
    q('from').onclick = () => { q('baseline').value = project()?.text || ''; q('baseline').focus(); if (!q('baseline').value) announce('เพิ่มข้อความในช่องข้อมูลต้นทาง หรือพิมพ์ข้อตกลงที่นี่'); };
    async function pin(input) {
      await write('baseline', input); clearPreview(); refresh(); q('baseline').value = pinned().text; q('edit').open = false;
      focus(q('request')); announce('ตรึงบรีฟฉบับ ' + pinned().revision + ' แล้ว');
    }
    q('pin').onclick = run(() => pin({ text: q('baseline').value.trim() }));
    q('pin-file').onclick = run(() => pin({ fileId: q('file').value }));
    q('request').oninput = clearPreview;
    q('compare').onclick = () => {
      const b = pinned(), request = q('request').value.trim(), container = q('decisions');
      clearPreview(); if (!b) { q('edit').open = true; q('baseline').focus(); return announce('ยืนยันบรีฟก่อนเทียบคำขอ'); }
      if (!request || rules.lines(request).length > 16) return announce('ใส่คำขอ 1 ถึง 16 บรรทัด');
      previewId = b.id;
      container.append(el('p', 'ตรวจประเภทและเลือกบรรทัดอ้างอิง ข้อที่ระบุว่าอยู่ในข้อตกลงต้องมีหลักฐาน'));
      const decisions = [], terms = rules.lines(b.text);
      for (const row of rules.suggest(b.text, request)) {
        const card = el('div'); card.className = 'wa-card'; const category = el('select'), evidence = el('select');
        for (const [k, name] of Object.entries(rules.categories)) category.append(opt(k, name));
        category.value = row.category; evidence.append(opt('', 'ยังไม่มีข้อความอ้างอิง'));
        terms.forEach((term, i) => evidence.append(opt(String(i), (i + 1) + '. ' + term))); evidence.value = row.evidence == null ? '' : String(row.evidence);
        card.append(el('strong', row.text), label('ประเภทคำขอ', category), label('บรรทัดอ้างอิงในบรีฟเดิม', evidence)); container.append(card);
        decisions.push(() => ({ category: category.value, evidence: evidence.value === '' ? null : Number(evidence.value) }));
      }
      container.append(btn('ยืนยันและเก็บผลเทียบ', run(async () => {
        const project = await write('reviews', { baselineId: b.id, request, decisions: decisions.map(get => get()) });
        selectedId = project.briefReviews.at(-1).id; q('request').value = ''; clearPreview(); refresh(); showHistory(); announce('เก็บผลเทียบพร้อมบรีฟอ้างอิงแล้ว'); focus(q('history'));
      }))); announce('พบ ' + decisions.length + ' รายการให้ตรวจ'); container.querySelector('select')?.focus();
    };
    q('history').onchange = () => { selectedId = q('history').value; q('result').hidden = true; renderDetail(); };
    q('handover').onclick = run(async () => { const id = activeId, result = await read(id + '/handover'); if (id === activeId) { output(result.text); announce('เตรียมบัตรส่งต่องานแล้ว'); } });
    q('board').onclick = run(async () => {
      const id = activeId, data = await read('board'); if (id !== activeId) return;
      const root = q('board-list'); root.replaceChildren(el('h3', 'ข้อเสนอทุกแฟ้ม'), el('p', 'รอลูกค้าตอบ ' + rules.money(data.totals.pending) + ' · ลูกค้าตกลงแล้ว ' + rules.money(data.totals.accepted)));
      if (!data.rows.length) root.append(el('p', 'เมื่อบันทึกข้อเสนอฉบับแรก รายการจะปรากฏที่นี่'));
      for (const row of data.rows) root.append(btn(row.title + ' · ' + row.request + ' · ' + rules.statuses[row.status] + ' · ' + rules.money(row.totalSatang), run(async () => {
        if (activeId !== row.projectId) await navigate(row.projectId);
        selectedId = row.reviewId; showHistory(); focus(q('history'));
      })));
      announce('พบ ' + data.rows.length + ' ข้อเสนอ');
    });
    q('copy').onclick = run(async () => {
      try { await navigator.clipboard.writeText(q('output').value); announce('คัดลอกข้อความแล้ว'); }
      catch { q('output').focus(); q('output').select(); announce('เลือกข้อความแล้ว ใช้คำสั่งคัดลอกของอุปกรณ์'); }
    });
    function open(plan) {
      q('panel').open = true;
      const targets = { life: 'handover', work: review() ? 'history' : 'request', 'work-pro': 'board' };
      const target = targets[plan] ? q(targets[plan]) : slot.querySelector('summary');
      target.scrollIntoView?.({ block: 'center' }); target.focus();
    }
    return { refresh, open, sources };
  }
  window.PanthoriumBriefUI = { create };
})();
