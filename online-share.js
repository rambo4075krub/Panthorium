(function () {
  'use strict';
  const {el, input, area, select, field, button, poster, friendly} = window.PanthoriumToolsUI;
  const heading = document.getElementById('share-title');
  const body = document.getElementById('share-body');
  const status = document.getElementById('share-status');
  const token = location.hash.slice(1);
  const path = '/api/online-tools/shared/' + encodeURIComponent(token);
  async function api(url, options = {}) {
    const res = await fetch(url, {cache: 'no-store', credentials: 'omit', ...options});
    const result = await res.json();
    if (!res.ok) throw Error(result.error || 'เปิดงานไม่ได้');
    return result;
  }
  function showForm(project) {
    const form = el('form');
    if (project.body.description) form.append(el('p', project.body.description));
    const fields = project.body.fields.map((f) => {
      const control =
        f.type === 'choice'
          ? select([['', 'เลือกคำตอบ'], ...f.options.map((v) => [v, v])], '')
          : f.type === 'long'
            ? area('', 1500)
            : input('', 240, f.type === 'number' ? 'number' : 'text');
      if (f.type === 'number') control.step = 'any';
      control.name = f.id;
      control.required = f.required;
      form.append(field(f.label + (f.required ? ' *' : ''), control));
      return control;
    });
    const send = el('button', 'ส่งคำตอบ', {type: 'submit'});
    form.append(send);
    let requestId, previous;
    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      if (send.disabled) return;
      const answers = Object.fromEntries(fields.map((control) => [control.name, control.value]));
      const signature = JSON.stringify(answers);
      if (signature !== previous) {
        requestId = crypto.randomUUID();
        previous = signature;
      }
      send.disabled = true;
      status.textContent = 'กำลังส่งคำตอบ…';
      try {
        await api(path + '/answers', {
          method: 'POST',
          headers: {'Content-Type': 'application/json'},
          body: JSON.stringify({revision: project.revision, requestId, answers})
        });
        body.replaceChildren();
        status.textContent = 'ส่งคำตอบแล้ว ขอบคุณที่ตอบแบบฟอร์ม';
      } catch (err) {
        status.textContent = friendly(err);
        if (err.message === 'form_changed')
          body.append(button('เปิดแบบฟอร์มฉบับล่าสุด', () => location.reload()));
        else if (!['link_closed', 'form_full'].includes(err.message)) send.disabled = false;
      }
    });
    body.append(form);
  }
  async function openShared() {
    if (!/^[a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12}$/i.test(token))
      throw Error('ลิงก์ไม่ครบ กรุณาเปิดลิงก์ที่เจ้าของส่งให้');
    const {project} = await api(path);
    heading.textContent = project.title;
    document.title = project.title + ' · Panthorium';
    if (project.kind === 'form') showForm(project);
    else {
      if (project.kind === 'design') {
        const preview = el('div', null, {class: 'ot-poster'});
        preview.append(await poster(project.body));
        body.append(preview);
      } else {
        for (const block of project.body.blocks) {
          const n = el(block.type === 'heading' ? 'h2' : 'p');
          if (block.type === 'check') {
            const tick = el('input', null, {
              type: 'checkbox',
              disabled: '',
              'aria-label': 'สถานะรายการ'
            });
            tick.checked = block.done;
            n.append(tick, document.createTextNode(' ' + block.text));
          } else n.textContent = block.text;
          body.append(n);
        }
      }
      body.append(el('a', 'ทำสำเนาใน Panthorium', {class: 'ot-action', href: '/#online-copy=' + token}));
    }
    status.textContent = '';
  }
  window.addEventListener('hashchange', () => location.reload());
  openShared().catch((err) => {
    body.replaceChildren();
    status.textContent = friendly(err);
  });
})();
