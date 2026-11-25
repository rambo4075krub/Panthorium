/* Shared by the signed-in workspace and its public form/template viewer. */
(function () {
  'use strict';
  function el(tag, value, attrs = {}) {
    const node = document.createElement(tag);
    if (value != null) node.textContent = value;
    for (const [k, v] of Object.entries(attrs)) if (v != null) node.setAttribute(k, String(v));
    return node;
  }
  function button(label, fn) {
    const b = el('button', label, {type: 'button'});
    b.onclick = fn;
    return b;
  }
  function field(label, input) {
    const box = el('label');
    const labelText = el('span', label);
    labelText.id = 'ot-label-' + crypto.randomUUID();
    input.setAttribute('aria-labelledby', labelText.id);
    box.append(labelText, input);
    return box;
  }
  function input(value = '', max = 120, type = 'text') {
    const n = el('input', null, {type, maxlength: max});
    n.value = value;
    return n;
  }
  function area(value = '', max = 1200) {
    const n = el('textarea', null, {maxlength: max, rows: 3});
    n.value = value;
    return n;
  }
  function select(items, value) {
    const n = el('select');
    for (const [v, t] of items) n.append(el('option', t, {value: v}));
    n.value = value;
    return n;
  }
  function check(value) {
    const n = el('input', null, {type: 'checkbox'});
    n.checked = value;
    return n;
  }
  function row(...items) {
    const n = el('div', null, {class: 'ot-row'});
    n.append(...items);
    return n;
  }
  function download(blob, name) {
    const a = el('a', null, {download: name, href: URL.createObjectURL(blob)});
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 30000);
  }
  function fileName(name, ext) {
    return (
      String(name || 'Panthorium')
        .replace(/[\\/:*?"<>|\u0000-\u001f]/g, '-')
        .slice(0, 90) + ext
    );
  }
  function picture(src) {
    return new Promise((resolve, reject) => {
      const p = new Image();
      p.onload = () => resolve(p);
      p.onerror = () => reject(Error('อ่านรูปภาพไม่ได้'));
      p.src = src;
    });
  }
  async function loadRaster(file, size) {
    if (
      !file ||
      file.size > 15 * 1024 * 1024 ||
      !['image/png', 'image/jpeg', 'image/webp'].includes(file.type)
    )
      throw Error('เลือกรูป PNG, JPEG หรือ WebP ไม่เกิน 15 MB');
    const url = URL.createObjectURL(file);
    try {
      const p = await picture(url),
        k = Math.min(1, size / Math.max(p.naturalWidth, p.naturalHeight));
      const c = el('canvas');
      c.width = Math.max(1, Math.round(p.naturalWidth * k));
      c.height = Math.max(1, Math.round(p.naturalHeight * k));
      c.getContext('2d').drawImage(p, 0, 0, c.width, c.height);
      return c;
    } finally {
      URL.revokeObjectURL(url);
    }
  }
  const blobOf = (canvas, type = 'image/png') =>
    new Promise((resolve, reject) =>
      canvas.toBlob((b) => (b ? resolve(b) : reject(Error('ส่งออกภาพไม่ได้'))), type)
    );
  function defaults(kind) {
    if (kind === 'form')
      return {
        description: '',
        fields: [{id: crypto.randomUUID(), label: 'ชื่องาน', type: 'short', required: true, options: []}]
      };
    if (kind === 'page')
      return {
        blocks: [
          {type: 'heading', text: 'งานที่ต้องทำ', done: false},
          {type: 'check', text: 'ตรวจรายละเอียดกับลูกค้า', done: false}
        ]
      };
    if (kind === 'design')
      return {
        layout: 'poster',
        size: 'square',
        background: '#fff4dd',
        ink: '#202b32',
        accent: '#cc482b',
        headline: 'คอลเลกชันใหม่',
        subtitle: 'สินค้าและบริการของร้าน',
        items: [],
        footer: 'สอบถามรายละเอียดกับทางร้าน',
        image: ''
      };
    return {source: null, labelField: null, actions: ['record', 'notify'], enabled: false};
  }
  function lines(ctx, value, maxWidth) {
    const result = [];
    let line = '';
    for (const ch of Array.from(value)) {
      if (line && ctx.measureText(line + ch).width > maxWidth) {
        result.push(line);
        line = '';
      }
      line += ch;
    }
    if (line) result.push(line);
    return result;
  }
  async function poster(data) {
    const c = el('canvas'),
      sizes = {square: [1080, 1080], story: [1080, 1920], a4: [900, 1273]};
    [c.width, c.height] = sizes[data.size];
    const ctx = c.getContext('2d'),
      w = c.width,
      h = c.height,
      m = Math.round(w * 0.067);
    const img = data.image ? await picture(data.image) : null;
    ctx.fillStyle = data.background;
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = data.accent;
    ctx.fillRect(m, m, w * 0.14, Math.ceil(w * 0.012));
    let y = m + w * 0.1;
    ctx.textBaseline = 'top';
    function write(str, size, color, bold, limit) {
      ctx.font = `${bold ? '700' : '400'} ${size}px system-ui, sans-serif`;
      ctx.fillStyle = color;
      const ls = lines(ctx, str, w - 2 * m);
      for (const [i, l] of ls.slice(0, limit).entries()) {
        ctx.fillText(i === limit - 1 && ls.length > limit ? l.slice(0, -1) + '…' : l, m, y, w - 2 * m);
        y += size * 1.4;
      }
    }
    write(data.headline, w * 0.067, data.ink, true, 2);
    write(data.subtitle, w * 0.03, data.ink, false, 2);
    y += w * 0.022;
    const footerY = h - m - w * 0.048,
      items = data.items || [];
    const lh = Math.min(w * 0.061, Math.max(w * 0.035, (footerY - y) / (items.length + 2)));
    if (img) {
      const boxH = Math.max(0, footerY - y - items.length * lh - w * 0.045);
      if (boxH > 10) {
        const bw = w - 2 * m,
          ratio =
            data.layout === 'poster'
              ? Math.max(bw / img.width, boxH / img.height)
              : Math.min(bw / img.width, boxH / img.height);
        ctx.save();
        ctx.beginPath();
        ctx.rect(m, y, bw, boxH);
        ctx.clip();
        ctx.drawImage(
          img,
          m + (bw - img.width * ratio) / 2,
          y + (boxH - img.height * ratio) / 2,
          img.width * ratio,
          img.height * ratio
        );
        ctx.restore();
        y += boxH + w * 0.025;
      }
    }
    for (const [index, item] of items.entries()) {
      if (data.layout === 'menu' && index % 2 === 0) {
        ctx.save();
        ctx.globalAlpha = 0.1;
        ctx.fillStyle = data.accent;
        ctx.fillRect(m, y, w - 2 * m, lh);
        ctx.restore();
      }
      ctx.fillStyle = data.ink;
      ctx.font = `500 ${Math.round(lh * 0.51)}px system-ui, sans-serif`;
      ctx.fillText(item, m + w * 0.012, y + lh * 0.12, w - 2 * m - w * 0.024);
      y += lh;
    }
    ctx.fillStyle = data.accent;
    ctx.fillRect(m, footerY - 10, w - 2 * m, 3);
    y = footerY;
    write(data.footer, w * 0.025, data.ink, false, 1);
    return c;
  }
  const messages = {
    revision_conflict: 'มีการแก้ไขจากอีกหน้าต่าง เปิดฉบับล่าสุดก่อนบันทึก',
    link_closed: 'ลิงก์นี้ปิดแล้ว',
    form_changed: 'ฟอร์มเปลี่ยนแล้ว กรุณาเปิดฉบับล่าสุด',
    required_field: 'กรอกคำถามที่จำเป็นให้ครบ',
    need_field: 'เพิ่มคำถามอย่างน้อยหนึ่งข้อ',
    need_two_choices: 'ใส่อย่างน้อยสองตัวเลือกที่ต่างกัน',
    project_limit: 'พื้นที่โครงการครบ 100 รายการแล้ว',
    team_limit: 'ทีมเต็มแล้ว',
    form_full: 'ฟอร์มรับคำตอบครบแล้ว',
    invalid_text: 'กรอกข้อความให้ครบตามความยาวที่กำหนด',
    select_form: 'เลือกฟอร์มก่อนเปิดใช้งาน',
    select_owned_form: 'เลือกฟอร์มในบัญชีของคุณ',
    auth_required: 'กรุณาเข้าสู่ระบบ',
    tools_storage_unavailable: 'พื้นที่เก็บงานยังไม่พร้อม',
    invalid_answers: 'ตรวจคำตอบอีกครั้ง',
    need_action: 'เลือกขั้นตอนอย่างน้อยหนึ่งรายการ',
    request_conflict: 'คำตอบคนละชุดใช้หมายเลขส่งซ้ำ กรุณาเริ่มรายการใหม่'
  };
  function friendly(e) {
    return messages[e.message] || e.message || 'ทำรายการไม่สำเร็จ';
  }
  let pdfPromise;
  function pdf() {
    if (!pdfPromise)
      pdfPromise = new Promise((resolve, reject) => {
        const s = el('script', null, {src: '/vendor/online-pdf-1.17.1.js'});
        s.onload = () =>
          window.PDFLib ? resolve(window.PDFLib) : reject(Error('โหลดเครื่องมือ PDF ไม่สำเร็จ'));
        s.onerror = () => reject(Error('โหลดเครื่องมือ PDF ไม่สำเร็จ'));
        document.head.append(s);
      }).catch((e) => {
        pdfPromise = null;
        throw e;
      });
    return pdfPromise;
  }
  window.PanthoriumToolsUI = {
    el,
    button,
    field,
    input,
    area,
    select,
    check,
    row,
    download,
    fileName,
    picture,
    loadRaster,
    blobOf,
    defaults,
    poster,
    friendly,
    pdf
  };
})();
