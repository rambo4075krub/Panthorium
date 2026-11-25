(function () {
  'use strict';
  const {el, button, field, input, area, select, check, row, loadRaster, poster, pdf, blobOf, fileName} =
    window.PanthoriumToolsUI;
  function formEditor(ctx, body, host) {
    const description = area(body.description),
      list = el('div'),
      entries = [];
    function add(f) {
      const box = el('fieldset'),
        label = input(f.label, 100),
        type = select(
          [
            ['short', 'ข้อความสั้น'],
            ['long', 'ย่อหน้า'],
            ['number', 'ตัวเลข'],
            ['choice', 'เลือกหนึ่งคำตอบ']
          ],
          f.type
        ),
        req = check(f.required),
        opts = area(f.options.join('\n'), 2400);
      const choices = field('ตัวเลือก แยกบรรทัด', opts);
      choices.hidden = type.value !== 'choice';
      type.onchange = () => {
        choices.hidden = type.value !== 'choice';
      };
      const entry = {
        id: f.id,
        box,
        read: () => ({
          id: f.id,
          label: label.value,
          type: type.value,
          required: req.checked,
          options:
            type.value === 'choice'
              ? opts.value
                  .split('\n')
                  .map((s) => s.trim())
                  .filter(Boolean)
              : []
        })
      };
      entries.push(entry);
      box.append(
        field('คำถาม', label),
        row(field('รูปแบบคำตอบ', type), field('ต้องตอบ', req)),
        choices,
        button('ลบคำถาม', () => {
          entries.splice(entries.indexOf(entry), 1);
          box.remove();
          ctx.changed();
        })
      );
      list.append(box);
    }
    body.fields.forEach(add);
    host.append(
      field('คำอธิบายสำหรับผู้ตอบ', description),
      list,
      button('เพิ่มคำถาม', () => {
        if (entries.length >= 20) return ctx.report('เพิ่มได้สูงสุด 20 คำถาม');
        add({id: crypto.randomUUID(), label: '', type: 'short', required: false, options: []});
        ctx.changed();
      })
    );
    return () => ({description: description.value, fields: entries.map((v) => v.read())});
  }
  function pageEditor(ctx, body, host) {
    const list = el('div'),
      entries = [];
    function add(b) {
      const box = el('fieldset'),
        type = select(
          [
            ['text', 'ย่อหน้า'],
            ['heading', 'หัวข้อ'],
            ['check', 'เช็กลิสต์']
          ],
          b.type
        ),
        txt = area(b.text),
        done = check(b.done),
        doneField = field('เสร็จแล้ว', done);
      doneField.hidden = type.value !== 'check';
      type.onchange = () => {
        doneField.hidden = type.value !== 'check';
      };
      const entry = {box, read: () => ({type: type.value, text: txt.value, done: done.checked})};
      entries.push(entry);
      const move = (step) => {
        const i = entries.indexOf(entry),
          j = i + step;
        if (j < 0 || j >= entries.length) return;
        [entries[i], entries[j]] = [entries[j], entries[i]];
        list.replaceChildren(...entries.map((e) => e.box));
        ctx.changed();
      };
      box.append(
        row(field('ชนิดบล็อก', type), doneField),
        field('เนื้อหา', txt),
        row(
          button('เลื่อนขึ้น', () => move(-1)),
          button('เลื่อนลง', () => move(1)),
          button('ลบบล็อก', () => {
            entries.splice(entries.indexOf(entry), 1);
            box.remove();
            ctx.changed();
          })
        )
      );
      list.append(box);
    }
    body.blocks.forEach(add);
    host.append(
      list,
      button('เพิ่มบล็อก', () => {
        if (entries.length >= 100) return ctx.report('เพิ่มได้สูงสุด 100 บล็อก');
        add({type: 'text', text: '', done: false});
        ctx.changed();
      })
    );
    return () => ({blocks: entries.map((e) => e.read())});
  }
  function designEditor(ctx, body, host, getTitle) {
    const layout = select(
        [
          ['poster', 'โปสเตอร์'],
          ['menu', 'เมนูราคา'],
          ['catalog', 'แค็ตตาล็อก']
        ],
        body.layout
      ),
      size = select(
        [
          ['square', 'จัตุรัส'],
          ['story', 'สตอรีแนวตั้ง'],
          ['a4', 'A4']
        ],
        body.size
      );
    const bg = input(body.background, 7, 'color'),
      ink = input(body.ink, 7, 'color'),
      accent = input(body.accent, 7, 'color'),
      headline = input(body.headline, 100),
      subtitle = input(body.subtitle, 200),
      footer = input(body.footer, 100),
      items = area(body.items.join('\n'), 810);
    const picker = el('input', null, {type: 'file', accept: 'image/png,image/jpeg,image/webp'}),
      preview = el('div', null, {class: 'ot-poster', 'aria-label': 'ตัวอย่างงานออกแบบ'});
    let image = body.image,
      serial = 0,
      timer;
    const collect = () => ({
      layout: layout.value,
      size: size.value,
      background: bg.value,
      ink: ink.value,
      accent: accent.value,
      headline: headline.value,
      subtitle: subtitle.value,
      footer: footer.value,
      items: items.value
        .split('\n')
        .map((s) => s.trim())
        .filter(Boolean),
      image
    });
    const draw = async () => {
      const n = ++serial;
      const c = await poster(collect());
      if (ctx.live() && n === serial) preview.replaceChildren(c);
    };
    const redraw = () => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        if (ctx.live()) draw().catch((e) => ctx.report(e.message));
      }, 100);
    };
    picker.onchange = ctx.handle(async () => {
      const f = picker.files[0];
      if (!f) return;
      const c = await loadRaster(f, 900);
      let value = c.toDataURL('image/png');
      if (value.length > 520000) {
        const flat = el('canvas');
        flat.width = c.width;
        flat.height = c.height;
        const g = flat.getContext('2d');
        g.fillStyle = bg.value;
        g.fillRect(0, 0, c.width, c.height);
        g.drawImage(c, 0, 0);
        value = flat.toDataURL('image/jpeg', 0.72);
      }
      if (value.length > 520000) throw Error('รูปนี้ใหญ่เกินไป โปรดลดขนาดรูป');
      image = value;
      ctx.changed();
      await draw();
    });
    const controls = el('div');
    controls.append(
      row(field('รูปแบบ', layout), field('ขนาด', size)),
      field('หัวเรื่อง', headline),
      field('ข้อความรอง', subtitle),
      field('รายการและราคา แยกบรรทัด สูงสุด 8 รายการ', items),
      field('ท้ายภาพ', footer),
      row(field('สีพื้น', bg), field('สีอักษร', ink), field('สีเน้น', accent)),
      field('ภาพสินค้า', picker),
      button('เอาภาพสินค้าออก', () => {
        image = '';
        picker.value = '';
        ctx.changed();
        redraw();
      })
    );
    controls.addEventListener('input', redraw);
    const split = el('div', null, {class: 'ot-design'});
    split.append(controls, preview);
    host.append(split);
    async function render(type, cloud) {
      const c = await poster(collect());
      let blob = await blobOf(c);
      if (type === 'pdf') {
        const lib = await pdf(),
          doc = await lib.PDFDocument.create(),
          img = await doc.embedPng(await blob.arrayBuffer());
        const w = size.value === 'a4' ? 595.28 : c.width * 0.75,
          h = size.value === 'a4' ? 841.89 : c.height * 0.75;
        doc.addPage([w, h]).drawImage(img, {x: 0, y: 0, width: w, height: h});
        blob = new Blob([await doc.save()], {type: 'application/pdf'});
      }
      await ctx.output(blob, fileName(getTitle(), '.' + type), cloud);
    }
    host.append(
      row(
        ctx.act('ดาวน์โหลด PNG', () => render('png', false)),
        ctx.act('ดาวน์โหลด PDF', () => render('pdf', false)),
        ctx.act('บันทึก PNG ในไฟล์ของฉัน', () => render('png', true))
      )
    );
    draw().catch((e) => ctx.report(e.message));
    return collect;
  }
  async function flowEditor(ctx, body, host, readOnly) {
    if (readOnly) {
      host.append(el('p', body.enabled ? 'เปิดใช้งานอยู่' : 'ปิดใช้งานอยู่'));
      if (body.actions.includes('record')) host.append(el('p', 'บันทึกรายการติดตามเมื่อมีคำตอบใหม่'));
      if (body.actions.includes('notify')) host.append(el('p', 'แจ้งสมาชิกทีมเมื่อมีคำตอบใหม่'));
      return () => body;
    }
    const forms = (await ctx.api('/projects')).items.filter((p) => p.kind === 'form' && p.owner),
      source = select([['', 'เลือกฟอร์ม'], ...forms.map((f) => [f.id, f.title])], body.source || '');
    const mapped = select([['', 'คำตอบใหม่']], ''),
      record = check(body.actions.includes('record')),
      notify = check(body.actions.includes('notify')),
      enabled = check(body.enabled);
    let rev = 0;
    async function fields(target) {
      const n = ++rev;
      mapped.replaceChildren(el('option', 'คำตอบใหม่', {value: ''}));
      if (source.value) {
        const f = (await ctx.api('/projects/' + source.value)).project;
        if (n !== rev || !ctx.live()) return;
        for (const item of f.body.fields) mapped.append(el('option', item.label, {value: item.id}));
      }
      mapped.value = target || '';
      if (mapped.selectedIndex < 0) mapped.value = '';
    }
    source.onchange = ctx.handle(() => fields(''));
    const box = el('fieldset');
    box.append(
      field('เมื่อมีคำตอบเข้าแบบฟอร์ม', source),
      field('ใช้คำตอบใดเป็นชื่อรายการงาน', mapped),
      row(field('สร้างรายการติดตาม', record), field('แจ้งเจ้าของและสมาชิกทีม', notify)),
      field('เปิดใช้งานเมื่อบันทึก', enabled)
    );
    host.append(box);
    await fields(body.labelField);
    return () => ({
      source: source.value || null,
      labelField: mapped.value || null,
      actions: [...(record.checked ? ['record'] : []), ...(notify.checked ? ['notify'] : [])],
      enabled: enabled.checked
    });
  }
  function blueprint(title, body) {
    return {
      format: 'panthorium-workflow',
      version: 1,
      title,
      trigger: 'form.submitted',
      actions: body.actions
    };
  }
  function readBlueprint(data) {
    if (
      !data ||
      data.format !== 'panthorium-workflow' ||
      data.version !== 1 ||
      data.trigger !== 'form.submitted' ||
      typeof data.title !== 'string' ||
      !data.title.trim() ||
      data.title.length > 120 ||
      !Array.isArray(data.actions) ||
      !data.actions.length ||
      data.actions.length > 2 ||
      new Set(data.actions).size !== data.actions.length ||
      data.actions.some((a) => !['record', 'notify'].includes(a))
    )
      throw Error('ไฟล์แม่แบบงานอัตโนมัติไม่ถูกต้อง');
    return {
      title: data.title,
      body: {actions: data.actions, enabled: false, source: null, labelField: null}
    };
  }
  window.PanthoriumToolProjects = {
    formEditor,
    pageEditor,
    designEditor,
    flowEditor,
    blueprint,
    readBlueprint
  };
})();
