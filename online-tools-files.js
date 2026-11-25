(function () {
  'use strict';
  const {el, field, input, select, row, fileName, loadRaster, blobOf, pdf} = window.PanthoriumToolsUI;
  function connectedBackground(rgba, w, h, tolerance, point) {
    const n = w * h,
      seen = new Uint8Array(n),
      queue = new Uint32Array(n),
      colors = [];
    function rgb(i) {
      return [rgba[4 * i], rgba[4 * i + 1], rgba[4 * i + 2]];
    }
    if (point !== undefined) colors.push(rgb(point));
    else {
      const groups = new Map();
      function sample(i) {
        if (rgba[i * 4 + 3] < 16) return;
        const [r, g, b] = rgb(i),
          key = (r >> 5) * 64 + (g >> 5) * 8 + (b >> 5);
        const v = groups.get(key) || [0, 0, 0, 0];
        v[0]++;
        v[1] += r;
        v[2] += g;
        v[3] += b;
        groups.set(key, v);
      }
      const step = Math.max(1, Math.floor(Math.min(w, h) / 128));
      for (let x = 0; x < w; x += step) {
        sample(x);
        sample((h - 1) * w + x);
      }
      for (let y = 0; y < h; y += step) {
        sample(y * w);
        sample(y * w + w - 1);
      }
      const top = [...groups.values()].sort((a, b) => b[0] - a[0]);
      for (const g of top.slice(0, 3))
        if (g[0] >= top[0][0] * 0.35) colors.push(g.slice(1).map((v) => v / g[0]));
    }
    const delta = tolerance * tolerance * 3;
    let read = 0,
      write = 0;
    function add(i) {
      if (seen[i]) return;
      seen[i] = 1;
      const k = i * 4;
      if (
        rgba[k + 3] < 16 ||
        colors.some(
          (c) => (rgba[k] - c[0]) ** 2 + (rgba[k + 1] - c[1]) ** 2 + (rgba[k + 2] - c[2]) ** 2 <= delta
        )
      )
        queue[write++] = i;
    }
    if (point !== undefined) add(point);
    else {
      for (let x = 0; x < w; x++) {
        add(x);
        add(n - w + x);
      }
      for (let y = 0; y < h; y++) {
        add(y * w);
        add(y * w + w - 1);
      }
    }
    while (read < write) {
      const i = queue[read++];
      rgba[i * 4 + 3] = 0;
      if (i % w) add(i - 1);
      if (i % w !== w - 1) add(i + 1);
      if (i >= w) add(i - w);
      if (i < n - w) add(i + w);
    }
    return write;
  }
  function cutout(ctx) {
    const {panel, act, report} = ctx,
      picker = el('input', null, {type: 'file', accept: 'image/png,image/jpeg,image/webp'}),
      canvas = el('canvas', null, {class: 'ot-cut', 'aria-label': 'ภาพสินค้าและพื้นหลัง'});
    canvas.width = canvas.height = 1;
    canvas.hidden = true;
    const tolerance = input('34', 3, 'range');
    tolerance.min = '3';
    tolerance.max = '110';
    const mode = select(
        [
          ['seed', 'แตะสีพื้นหลัง'],
          ['erase', 'แปรงลบ'],
          ['restore', 'แปรงคืนภาพ']
        ],
        'seed'
      ),
      size = input('20', 3, 'range');
    size.min = '2';
    size.max = '110';
    let src,
      data,
      history = [],
      drawing = false,
      previous,
      base = 'สินค้า';
    function draw() {
      canvas.getContext('2d').putImageData(data, 0, 0);
    }
    function snapshot() {
      if (!data) throw Error('เลือกรูปภาพก่อน');
      const alpha = new Uint8Array(data.data.length / 4);
      for (let i = 0; i < alpha.length; i++) alpha[i] = data.data[i * 4 + 3];
      history.push(alpha);
      if (history.length > 6) history.shift();
    }
    function pos(e) {
      const r = canvas.getBoundingClientRect();
      return [
        Math.max(
          0,
          Math.min(canvas.width - 1, Math.floor(((e.clientX - r.left) * canvas.width) / r.width))
        ),
        Math.max(
          0,
          Math.min(canvas.height - 1, Math.floor(((e.clientY - r.top) * canvas.height) / r.height))
        )
      ];
    }
    function stroke(a, b) {
      const radius = Number(size.value),
        dx = b[0] - a[0],
        dy = b[1] - a[1],
        steps = Math.max(1, Math.ceil(Math.hypot(dx, dy) / Math.max(1, radius / 2)));
      for (let k = 1; k <= steps; k++) {
        const cx = Math.round(a[0] + (dx * k) / steps),
          cy = Math.round(a[1] + (dy * k) / steps);
        for (let y = Math.max(0, cy - radius); y <= Math.min(canvas.height - 1, cy + radius); y++)
          for (let x = Math.max(0, cx - radius); x <= Math.min(canvas.width - 1, cx + radius); x++) {
            if ((x - cx) ** 2 + (y - cy) ** 2 > radius * radius) continue;
            const off = 4 * (y * canvas.width + x) + 3;
            data.data[off] = mode.value === 'erase' ? 0 : src.data[off];
          }
      }
      draw();
    }
    picker.onchange = ctx.handle(async () => {
      const f = picker.files[0];
      if (!f) return;
      const scaled = await loadRaster(f, 1600);
      if (!ctx.live()) return;
      canvas.width = scaled.width;
      canvas.height = scaled.height;
      const g = canvas.getContext('2d', {willReadFrequently: true});
      g.drawImage(scaled, 0, 0);
      src = g.getImageData(0, 0, canvas.width, canvas.height);
      data = g.getImageData(0, 0, canvas.width, canvas.height);
      history = [];
      canvas.hidden = false;
      base = f.name.replace(/\.[^.]+$/, '');
      report('เลือกลบพื้นหลังจากขอบภาพ หรือแตะสีที่ต้องการลบ');
    });
    canvas.onpointerdown = (e) => {
      if (!data) return;
      e.preventDefault();
      snapshot();
      const p = pos(e);
      if (mode.value === 'seed') {
        connectedBackground(
          data.data,
          canvas.width,
          canvas.height,
          Number(tolerance.value),
          p[1] * canvas.width + p[0]
        );
        draw();
      } else {
        drawing = true;
        previous = p;
        canvas.setPointerCapture(e.pointerId);
        stroke(p, p);
      }
      ctx.changed();
    };
    canvas.onpointermove = (e) => {
      if (drawing) {
        const p = pos(e);
        stroke(previous, p);
        previous = p;
      }
    };
    canvas.onpointerup =
      canvas.onpointercancel =
      canvas.onlostpointercapture =
        () => {
          drawing = false;
        };
    const save = async (cloud) => {
      if (!data) throw Error('เลือกรูปภาพก่อน');
      await ctx.output(await blobOf(canvas), fileName(base + '-โปร่งใส', '.png'), cloud);
      ctx.clean();
    };
    panel.append(
      field('รูปสินค้า', picker),
      row(field('ความใกล้เคียงของสี', tolerance), field('วิธีแต่งขอบ', mode), field('ขนาดแปรง', size)),
      row(
        act('ลบพื้นหลังจากขอบภาพ', () => {
          snapshot();
          connectedBackground(data.data, canvas.width, canvas.height, Number(tolerance.value));
          draw();
          ctx.changed();
        }),
        act('ย้อนกลับ', () => {
          if (!history.length) return;
          const a = history.pop();
          for (let i = 0; i < a.length; i++) data.data[i * 4 + 3] = a[i];
          draw();
          ctx.changed();
        }),
        act('คืนภาพเดิม', () => {
          snapshot();
          data.data.set(src.data);
          draw();
          ctx.changed();
        })
      ),
      canvas,
      row(
        act('ดาวน์โหลด PNG', () => save(false)),
        act('บันทึก PNG ในไฟล์ของฉัน', () => save(true))
      )
    );
  }
  function pageList(raw, max) {
    if (!raw.trim()) return Array.from({length: max}, (_, i) => i);
    const out = [];
    for (const part of raw.split(',')) {
      const m = part.trim().match(/^([1-9]\d*)(?:\s*-\s*([1-9]\d*))?$/);
      if (!m) throw Error('ระบุหน้า เช่น 1-3,5');
      const first = Number(m[1]),
        last = Number(m[2] || m[1]);
      if (last < first || last > max || out.length + last - first + 1 > 200)
        throw Error('เลขหน้าอยู่นอกช่วงหรือเกิน 200 หน้า');
      for (let i = first; i <= last; i++) out.push(i - 1);
    }
    return out;
  }
  function pdfDesk(ctx) {
    const {panel, act} = ctx,
      picker = el('input', null, {type: 'file', multiple: '', accept: '.pdf,.png,.jpg,.jpeg'}),
      list = el('ol', null, {class: 'ot-filelist'}),
      name = input('ชุดเอกสาร');
    const inputs = [];
    function paint() {
      list.replaceChildren();
      for (const [i, f] of inputs.entries()) {
        const li = el('li'),
          range = input(f.range);
        range.placeholder = 'ทุกหน้า หรือ 1-3,5';
        range.oninput = () => {
          f.range = range.value;
          ctx.changed();
        };
        li.append(el('strong', f.name));
        if (f.type === 'pdf') li.append(field(`${f.count} หน้า · หน้าที่เลือก`, range));
        const move = (n) => {
          const j = i + n;
          if (j < 0 || j >= inputs.length) return;
          [inputs[i], inputs[j]] = [inputs[j], inputs[i]];
          paint();
          ctx.changed();
        };
        li.append(
          row(
            act('ขึ้น', () => move(-1)),
            act('ลง', () => move(1)),
            act('เอาออก', () => {
              inputs.splice(i, 1);
              paint();
              ctx.changed();
            })
          )
        );
        list.append(li);
      }
    }
    picker.onchange = ctx.handle(async () => {
      const picked = Array.from(picker.files);
      picker.value = '';
      if (!picked.length) return;
      if (
        inputs.length + picked.length > 25 ||
        [...inputs, ...picked].reduce((s, f) => s + f.size, 0) > 25 * 1024 ** 2
      )
        throw Error('รองรับ 25 ไฟล์ รวมไม่เกิน 25 MB');
      const lib = await pdf(),
        next = [];
      for (const file of picked) {
        const bytes = new Uint8Array(await file.arrayBuffer()),
          type = /\.pdf$/i.test(file.name)
            ? 'pdf'
            : /\.png$/i.test(file.name)
              ? 'png'
              : /\.jpe?g$/i.test(file.name)
                ? 'jpg'
                : '';
        if (!type) throw Error('รองรับ PDF, PNG และ JPEG');
        let doc,
          count = 1;
        if (type === 'pdf') {
          try {
            doc = await lib.PDFDocument.load(bytes, {updateMetadata: false});
          } catch {
            throw Error('เปิด PDF ไม่สำเร็จ ตรวจสอบว่าไฟล์เปิดได้และไม่มีรหัสผ่าน');
          }
          count = doc.getPageCount();
          if (count < 1 || count > 500) throw Error('รองรับต้นฉบับ PDF ไม่เกิน 500 หน้าต่อไฟล์');
        }
        next.push({name: file.name, size: file.size, bytes, doc, count, type, range: ''});
      }
      if (ctx.live()) {
        inputs.push(...next);
        paint();
        ctx.changed();
      }
    });
    async function merge(cloud) {
      if (!inputs.length) throw Error('เลือกไฟล์ต้นฉบับก่อน');
      const lib = await pdf(),
        out = await lib.PDFDocument.create();
      for (const f of inputs) {
        if (f.type === 'pdf') {
          const idx = pageList(f.range, f.count);
          if (out.getPageCount() + idx.length > 200) throw Error('ส่งออกได้ไม่เกิน 200 หน้า');
          for (const p of await out.copyPages(f.doc, idx)) out.addPage(p);
        } else {
          if (out.getPageCount() >= 200) throw Error('ส่งออกได้ไม่เกิน 200 หน้า');
          const pic = f.type === 'png' ? await out.embedPng(f.bytes) : await out.embedJpg(f.bytes);
          const p = out.addPage([595.28, 841.89]),
            scale = Math.min(p.getWidth() / pic.width, p.getHeight() / pic.height),
            w = pic.width * scale,
            h = pic.height * scale;
          p.drawImage(pic, {x: (p.getWidth() - w) / 2, y: (p.getHeight() - h) / 2, width: w, height: h});
        }
      }
      const bytes = await out.save();
      await ctx.output(
        new Blob([bytes], {type: 'application/pdf'}),
        fileName(name.value, '.pdf'),
        cloud
      );
      ctx.clean();
    }
    panel.append(
      field('เลือก PDF หรือรูปภาพ', picker),
      list,
      field('ชื่อไฟล์ผลลัพธ์', name),
      row(
        act('ดาวน์โหลด PDF', () => merge(false)),
        act('บันทึก PDF ในไฟล์ของฉัน', () => merge(true))
      )
    );
  }
  window.PanthoriumToolFiles = {cutout, pdfDesk, connectedBackground, pageList};
})();
