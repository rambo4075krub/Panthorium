(function () {
  'use strict';
  const {el, button, field, input, area, select, row, download, friendly} = window.PanthoriumToolsUI;
  const uuid = () => crypto.randomUUID();
  const json = (method, body) => ({method, body: JSON.stringify(body)});
  const formats = [
    ['short', 'หนังสั้น'],
    ['movie', 'ภาพยนตร์'],
    ['feature', 'หนังยาว 2–3 ชั่วโมง'],
    ['series', 'ซีรีส์']
  ];
  const stages = [
    ['story', 'เนื้อเรื่อง'],
    ['character', 'ตัวละคร'],
    ['location', 'ฉากหลัง'],
    ['frame', 'สตอรีบอร์ด'],
    ['clip', 'วิดีโอ']
  ];
  const labels = Object.fromEntries([...stages, ['episode', 'รวม MP4']]);
  const episode = (title) => ({id: uuid(), title, story: '', shots: []});
  const Feature = window.PanthoriumFeatureFilm;
  const messages = {
    manual: 'พักตามคำสั่ง',
    feature_footage_selected: 'ลำดับนี้ใช้ฟุตเทจอยู่ ถอดฟุตเทจก่อนวางช็อตใหม่',
    film_duration_exceeded: 'เวลาของหนังเกิน 180 นาที ปรับช่วงฟุตเทจหรือความยาวช็อต',
    invalid_feature_sequence: 'ตรวจองก์และเวลาที่กำหนดให้ลำดับฉาก',
    invalid_feature_footage: 'กำหนดช่วงฟุตเทจตั้งแต่ 0 ถึง 120 วินาทีต่อหนึ่งลำดับ',
    feature_export_unavailable: 'ไฟล์ดาวน์โหลดหมดอายุหรือบทเปลี่ยนแล้ว กรุณารวมไฟล์อีกครั้ง',
    feature_review_required: 'ตรวจผลคำสั่งก่อนหน้ากับผู้ให้บริการก่อนยืนยันใหม่',
    feature_no_work: 'ยังไม่มีลำดับที่ต้องสร้าง เพิ่มบทหรือฟุตเทจก่อน',
    film_project_too_large: 'ข้อมูลโปรเจกต์เกินขนาดที่จัดเก็บได้',
    film_unfinished_parts: 'สร้าง MP4 ของทุกตอนหรือลำดับฉากให้ครบก่อนดาวน์โหลดทั้งเรื่อง',
    film_export_space: 'พื้นที่ชั่วคราวบนเซิร์ฟเวอร์ไม่พอสำหรับรวมทั้งเรื่อง',
    media_worker_busy: 'เครื่องส่งออกกำลังทำงานอื่น ลองอีกครั้งเมื่อเสร็จ',
    invalid_film_plan: 'Gemini ส่งแผนฉากไม่ครบ ลองวางแผนอีกครั้งหรือเพิ่มช็อตเองได้',
    film_story_required: 'ใส่เนื้อเรื่องของตอนก่อนวางแผน',
    film_shots_required: 'เพิ่มช็อตหรือให้ Gemini วางแผนก่อนสร้างวิดีโอ',
    film_planner_unavailable: 'ยังติดต่อ Gemini สำหรับวางแผนไม่ได้ คุณยังเขียนบทและวางช็อตเองได้',
    invalid_film_episodes: 'หนังสั้นมีหนึ่งลำดับฉาก หากมีหลายตอนให้เลือกภาพยนตร์หรือซีรีส์',
    film_job_active: 'โปรเจกต์นี้มีงานอยู่ในคิวแล้ว',
    studio_daily_limit: 'โควตาสร้างสื่อวันนี้ไม่พอสำหรับชุดนี้ งานที่เสร็จแล้วเปิดดูได้',
    film_over_daily_limit: 'จำนวนภาพและคลิปเกินโควตาต่อวัน เลือกสร้างทีละช็อตแล้วค่อยรวมตอน',
    film_quote_changed: 'ภาพอ้างอิงมีการเปลี่ยนแปลง โปรดตรวจจำนวนงานอีกครั้ง',
    image_generation_unavailable: 'บริการสร้างภาพยังไม่พร้อมสำหรับบัญชีนี้',
    video_generation_unavailable: 'บริการสร้างวิดีโอยังไม่พร้อมสำหรับบัญชีนี้',
    studio_submission_uncertain:
      'ยังยืนยันผลจากผู้ให้บริการไม่ได้ กรุณาตรวจไฟล์และประวัติงานก่อนสั่งสร้างซ้ำ',
    studio_plugin_disabled: 'ปลั๊กอินนี้ปิดอยู่ใน Creative Studio',
    revision_conflict: 'โปรเจกต์มีการแก้ไขจากอีกหน้าต่าง กลับไปรายการแล้วเปิดฉบับล่าสุด',
    invalid_text: 'ตรวจชื่อโปรเจกต์ ชื่อตอน ชื่อตัวละคร และคำอธิบายช็อตให้ครบ',
    files_storage_unconfigured: 'พื้นที่เก็บไฟล์ยังไม่พร้อม',
    studio_storage_unconfigured: 'คิวสร้างสื่อยังไม่พร้อม',
    studio_active_limit: 'บัญชีนี้มีงานกำลังสร้างเต็มจำนวนแล้ว',
    system_busy: 'ระบบกำลังประมวลผลงานอื่น ลองอีกครั้งภายหลัง'
  };
  const detail = (e) =>
    messages[e?.message || e] || friendly(e instanceof Error ? e : Error(e || 'งานสร้างสื่อไม่สำเร็จ'));
  function mount(ctx) {
    let p,
      epId,
      stage = 'story',
      dirty = false,
      count = 2,
      assets = {},
      job = null,
      timer,
      drawing = 0;
    let pollBusy = false,
      pending = null,
      requestBusy = false;
    let info = null,
      out = null,
      baseline = new Map(),
      actFilter = 'all';
    const feature = () => p?.body.format === 'feature';
    const remember = () => {
      baseline = new Map((p?.body.episodes || []).map((e) => [e.id, JSON.stringify(e)]));
    };
    const featureBusy = () =>
      feature() && (info?.run?.status === 'running' || ['queued', 'running'].includes(out?.status));
    const urls = new Set();
    let observer;
    function release() {
      drawing++;
      observer?.disconnect();
      for (const url of urls) URL.revokeObjectURL(url);
      urls.clear();
    }
    ctx.signal.addEventListener(
      'abort',
      () => {
        clearTimeout(timer);
        release();
      },
      {once: true}
    );
    const active = () => ['queued', 'running'].includes(job?.status);
    const current = () => p?.body.episodes.find((e) => e.id === epId);
    function changed() {
      dirty = true;
      ctx.changed();
    }
    function clean() {
      dirty = false;
      ctx.clean();
    }
    const act = (label, fn) =>
      ctx.act(label, async (event) => {
        requestBusy = true;
        try {
          await fn(event);
        } catch (e) {
          if (ctx.live()) ctx.report(detail(e));
        } finally {
          requestBusy = false;
        }
      });
    function editField(label, control, target, key, read = (x) => x.value) {
      control.oninput = () => {
        target[key] = read(control);
        changed();
      };
      return field(label, control);
    }
    function clearPanel() {
      release();
      ctx.panel.replaceChildren();
    }
    const endpoint = (suffix) => '/film/' + p.id + '/' + suffix;
    async function list() {
      if (dirty && !confirm('ออกจากโปรเจกต์โดยละการแก้ไขที่ยังไม่ได้บันทึกหรือไม่?')) return;
      clearTimeout(timer);
      clean();
      p = null;
      info = null;
      out = null;
      baseline.clear();
      actFilter = 'all';
      assets = {};
      job = null;
      clearPanel();
      ctx.report('');
      const holder = el('div', null, {class: 'ot-cards'});
      ctx.panel.append(
        ...[
          ['สร้างโปรเจกต์ใหม่', 'short'],
          ['สร้างหนังยาว 2–3 ชั่วโมง', 'feature']
        ].map(([label, format]) =>
          act(label, () => {
            const first = episode(format === 'feature' ? 'ลำดับฉากที่ 1' : 'ตอนที่ 1');
            p = {
              id: uuid(),
              kind: 'film',
              title: '',
              body: {
                format,
                ...(format === 'feature' ? {feature: Feature.defaults()} : {}),
                aspect: '16:9',
                style: '',
                characters: [],
                locations: [],
                episodes: [first]
              }
            };
            epId = first.id;
            stage = feature() ? 'feature' : 'story';
            pending = null;
            changed();
            draw();
          })
        ),
        holder
      );
      const data = await ctx.api('/projects');
      if (!ctx.live() || !holder.isConnected) return;
      for (const item of data.items.filter((x) => x.kind === 'film'))
        holder.append(
          act(item.title, async () => {
            const d = await ctx.api('/projects/' + item.id);
            if (!ctx.live()) return;
            p = d.project;
            remember();
            epId = p.body.episodes[0].id;
            stage = feature() ? 'feature' : 'story';
            pending = null;
            clean();
            draw();
            await refresh();
          })
        );
      if (!holder.childNodes.length) holder.append(el('p', 'ยังไม่มีโปรเจกต์หนังที่บันทึกไว้'));
    }
    async function save() {
      if (!dirty && p.revision) return;
      if (!p.title.trim()) throw Error('ใส่ชื่อโปรเจกต์ก่อนบันทึก');
      if (feature()) {
        const {episodes, ...meta} = p.body;
        const payload = p.revision
          ? {
              title: p.title,
              revision: p.revision,
              meta,
              order: episodes.map((e) => e.id),
              changes: episodes.filter((e) => baseline.get(e.id) !== JSON.stringify(e))
            }
          : {id: p.id, title: p.title, body: p.body};
        const reply = await ctx.api(p.revision ? endpoint('draft') : '/film/feature-drafts', {
          ...json(p.revision ? 'PUT' : 'POST', payload),
          headers: {'Content-Type': 'application/vnd.panthorium.film+json'}
        });
        if (!ctx.live()) throw Error('auth_required');
        if (reply.project) p = reply.project;
        else p.revision = reply.revision;
        remember();
        clean();
        pending = null;
        return;
      }
      const data = await ctx.api(
        '/projects' + (p.revision ? '/' + p.id : ''),
        json(p.revision ? 'PUT' : 'POST', {
          id: p.id,
          kind: 'film',
          title: p.title,
          body: p.body,
          revision: p.revision
        })
      );
      if (!ctx.live()) throw Error('auth_required');
      p = data.project;
      clean();
      pending = null;
    }
    function queuePoll() {
      clearTimeout(timer);
      if (!(active() || featureBusy()) || !ctx.live()) return;
      timer = setTimeout(async () => {
        if (!ctx.live() || !p || !(active() || featureBusy())) return;
        if (pollBusy || requestBusy || dirty) {
          queuePoll();
          return;
        }
        const projectKey = p.id;
        pollBusy = true;
        try {
          if (ctx.live() && projectKey === p?.id && !requestBusy) await refresh();
        } catch (e) {
          if (ctx.live() && projectKey === p?.id) ctx.report(detail(e));
        } finally {
          pollBusy = false;
          if (ctx.live()) queuePoll();
        }
      }, 7000);
    }
    async function refresh() {
      const projectKey = p.id,
        part = epId;
      const [data, overview, exportState] = await Promise.all([
        ctx.api(endpoint(part)),
        feature() ? ctx.api(endpoint('feature/overview')) : null,
        feature() ? ctx.api(endpoint('feature/export')) : null
      ]);
      if (!ctx.live() || projectKey !== p?.id || part !== epId) return;
      info = overview;
      out = exportState;
      assets = data.assets;
      job = data.job;
      if (active()) await ctx.trackJob(job.id);
      if (!ctx.live() || projectKey !== p?.id || part !== epId) return;
      if (!dirty) draw();
      queuePoll();
    }
    function stageButton(key, label) {
      const b = act(label, () => {
        if (feature() && key === 'story' && stage === 'feature')
          count = Math.max(1, Math.min(8, Math.ceil((current().plannedSeconds || 16) / 8)));
        stage = key;
        draw();
      });
      b.setAttribute('aria-pressed', String(stage === key));
      return b;
    }
    async function go(part) {
      const ep = p.body.episodes.find((e) => e.id === part);
      if (!ep) return;
      epId = part;
      assets = {};
      stage = 'story';
      actFilter = 'all';
      if (feature()) count = Math.max(1, Math.min(8, Math.ceil((ep.plannedSeconds || 16) / 8)));
      draw();
      if (p.revision && !dirty) await refresh();
    }
    const partName = () => (p.body.format === 'series' ? 'ตอน' : 'ลำดับฉาก');
    function draw() {
      if (!ctx.live() || !p) return;
      clearPanel();
      const top = row(
        act('โปรเจกต์ทั้งหมด', list),
        el('strong', p.title || 'โปรเจกต์ใหม่'),
        act('บันทึกโปรเจกต์', async () => {
          await save();
          await refresh();
          ctx.report('บันทึกโปรเจกต์แล้ว');
        })
      );
      top.classList.add('film-toolbar');
      const choices = feature() ? [['feature', 'ภาพรวมหนังยาว'], ...stages] : stages;
      const tabs = row(...choices.map(([key, name]) => stageButton(key, name)));
      tabs.classList.add('film-tabs');
      const ep = current();
      if (feature() && actFilter !== 'all' && Number(actFilter) !== (ep.act || 1)) actFilter = 'all';
      const parts = select(
        p.body.episodes
          .filter((e) => !feature() || actFilter === 'all' || (e.act || 1) === Number(actFilter))
          .map((e) => [e.id, e.title]),
        ep.id
      );
      parts.onchange = ctx.handle(async () => {
        epId = parts.value;
        if (feature()) count = Math.max(1, Math.min(8, Math.ceil((current().plannedSeconds || 16) / 8)));
        assets = {};
        draw();
        if (p.revision) await refresh();
      });
      ctx.panel.append(top);
      if (p.body.format !== 'short') {
        const group = row(
          field('เลือก' + partName(), parts),
          act('เพิ่ม' + partName(), () => {
            if (p.body.episodes.length >= (feature() ? 360 : 40))
              throw Error('โปรเจกต์นี้มีลำดับฉากครบแล้ว');
            const next = episode(partName() + 'ที่ ' + (p.body.episodes.length + 1));
            if (feature()) next.act = Number(actFilter) || ep.act || 1;
            p.body.episodes.push(next);
            epId = next.id;
            stage = 'story';
            assets = {};
            changed();
            draw();
          })
        );
        if (feature()) {
          const choose = select(
            [['all', 'ทุกองก์'], ...['1', '2', '3'].map((n) => [n, 'องก์ ' + n])],
            actFilter
          );
          choose.onchange = ctx.handle(async () => {
            const first = p.body.episodes.find(
              (e) => choose.value === 'all' || (e.act || 1) === Number(choose.value)
            );
            if (!first) {
              choose.value = actFilter;
              return ctx.report('ยังไม่มีลำดับฉากในองก์นี้');
            }
            await go(first.id);
            actFilter = choose.value;
            draw();
          });
          group.prepend(field('กรองตามองก์', choose));
          const list = p.body.episodes,
            index = list.indexOf(ep);
          const move = (offset) => {
            list.splice(index + offset, 0, ...list.splice(index, 1));
            changed();
            draw();
          };
          const up = act('เลื่อนลำดับก่อนหน้า', () => move(-1)),
            down = act('เลื่อนลำดับถัดไป', () => move(1));
          up.disabled = index === 0;
          down.disabled = index === list.length - 1;
          const remove = act('นำลำดับนี้ออก', () => {
            if (!confirm('นำ ' + ep.title + ' ออกจากฉบับตัดต่อนี้หรือไม่?')) return;
            list.splice(index, 1);
            epId = list[Math.min(index, list.length - 1)].id;
            assets = {};
            changed();
            draw();
          });
          remove.disabled = list.length <= 1;
          group.append(up, down, remove);
        }
        ctx.panel.append(group);
      }
      ctx.panel.append(tabs);
      if (job) {
        const states = {
          queued: 'อยู่ในคิว',
          running: 'กำลังสร้าง',
          completed: 'เสร็จแล้ว',
          failed: 'สร้างไม่สำเร็จ',
          needs_review: 'ต้องตรวจผล'
        };
        const note = el('div', null, {class: 'film-job', role: 'status'});
        const ownerEpisode = p.body.episodes.find((e) => e.id === job.episode);
        note.append(
          el(
            'strong',
            (ownerEpisode?.title || '') +
              ' · ' +
              (states[job.status] || job.status) +
              ' ' +
              job.done +
              '/' +
              job.total
          )
        );
        if (active() && job.target) note.append(el('span', labels[job.target.split(':')[0]]));
        if (job.error) note.append(el('span', detail(job.error)));
        ctx.panel.append(note);
      }
      const view = {
        p,
        ep,
        act,
        change: changed,
        redraw: draw,
        edit: editField,
        info: dirty ? null : info,
        out: dirty ? null : out,
        save,
        refresh,
        endpoint,
        ctx,
        go,
        detail,
        json
      };
      if (stage === 'feature' && feature()) {
        ctx.panel.append(editField('ชื่อโปรเจกต์', input(p.title), p, 'title'));
        Feature.workspace(view);
      } else if (stage === 'story') {
        story(ep);
        if (feature()) {
          ctx.panel.append(
            editField(
              'องก์ของลำดับฉาก',
              select(
                [1, 2, 3].map((n) => [String(n), 'องก์ ' + n]),
                String(ep.act || 1)
              ),
              ep,
              'act',
              (c) => Number(c.value)
            )
          );
          Feature.footage(view);
        }
      } else if (stage === 'character' || stage === 'location') references(stage);
      else shots(ep, stage === 'clip');
    }
    function story(ep) {
      const format = select(formats, p.body.format);
      format.onchange = () => {
        if (format.value === 'short' && p.body.episodes.length > 1) {
          format.value = p.body.format;
          ctx.report(messages.invalid_film_episodes);
          return;
        }
        if (
          feature() &&
          format.value !== 'feature' &&
          (p.revision ||
            p.body.episodes.length > 1 ||
            p.body.feature.screenplay ||
            p.body.feature.synopsis ||
            ep.footage)
        ) {
          format.value = 'feature';
          ctx.report('โปรเจกต์หนังยาวนี้มีบทหรือฉากที่บันทึกอยู่แล้ว');
          return;
        }
        p.body.format = format.value;
        if (feature()) {
          p.body.feature ||= Feature.defaults();
          stage = 'feature';
        }
        changed();
        draw();
      };
      const n = select(
        Array.from({length: 8}, (_, i) => [String(i + 1), String(i + 1)]),
        String(count)
      );
      n.onchange = () => {
        count = Number(n.value);
      };
      const narrative = area(ep.story, 8000);
      narrative.rows = 6;
      narrative.placeholder = 'ใครต้องการอะไร เกิดเหตุการณ์อะไร และเรื่องจบอย่างไร';
      ctx.panel.append(
        row(
          editField('ชื่อโปรเจกต์', input(p.title), p, 'title'),
          field('ประเภท', format),
          editField(
            'สัดส่วนภาพ',
            select(
              [
                ['16:9', 'แนวนอน 16:9'],
                ['9:16', 'แนวตั้ง 9:16']
              ],
              p.body.aspect
            ),
            p.body,
            'aspect'
          )
        ),
        editField('ชื่อ' + partName(), input(ep.title, 90), ep, 'title'),
        editField('เนื้อเรื่อง', narrative, ep, 'story'),
        editField('สไตล์ภาพ', input(p.body.style, 200), p.body, 'style'),
        row(
          field('จำนวนช็อตที่ให้ Gemini วางแผน', n),
          act('ให้ Gemini วางแผนฉาก', () => plan(false)),
          ...(feature() ? [] : [act('สร้างจากเรื่องจนจบเป็น MP4', () => plan(true))])
        )
      );
    }
    async function plan(auto) {
      if (feature() && current().footage)
        throw Error('ลำดับนี้ใช้ฟุตเทจของคุณ ถอดฟุตเทจก่อนวางสตอรีบอร์ดใหม่');
      if (
        !(
          current().story.trim() ||
          (feature() && (p.body.feature.synopsis.trim() || p.body.feature.screenplay.trim()))
        )
      )
        throw Error('film_story_required');
      if (active()) throw Error('film_job_active');
      const replace = current().shots.length ? ' ระบบจะแทนที่รายการช็อตในตอนนี้' : '';
      if (auto) {
        if (
          !confirm(
            'ให้ Gemini วางแผน แล้วสร้างภาพ คลิป และรวม MP4 โดยอัตโนมัติ? การสร้างสื่ออาจมีค่าใช้จ่ายและใช้โควตาได้สูงสุด 10 ภาพและคลิปรวมกันต่อการสั่งครั้งนี้' +
              replace
          )
        )
          return;
      } else if (replace && !confirm(replace.trim() + ' ดำเนินการหรือไม่?')) return;
      await save();
      ctx.report('Gemini กำลังแยกตัวละคร ฉากหลัง และวางช็อต…');
      const result = await ctx.api(
        endpoint('plan'),
        json('POST', {episode: epId, revision: p.revision, count, auto})
      );
      if (!ctx.live()) return;
      p = result.project;
      remember();
      clean();
      stage = auto ? 'clip' : 'frame';
      draw();
      await refresh();
      if (auto) await produce('episode:' + epId, true);
      else ctx.report('แผนฉากพร้อมแล้ว เลือกช็อตเพื่อปรับบท อารมณ์ และมุมกล้อง');
    }
    async function produce(target, auto = false) {
      if (active()) throw Error('film_job_active');
      await save();
      const intent = p.id + ':' + p.revision + ':' + target;
      if (pending?.intent !== intent) pending = {intent, requestId: uuid()};
      const body = {requestId: pending.requestId, episode: epId, revision: p.revision, target};
      if (!auto) {
        const preview = await ctx.api(endpoint('quote'), json('POST', body));
        if (!ctx.live()) return;
        const q = preview.quote;
        if (!q.images && !q.videos && !q.assemble) {
          await refresh();
          ctx.report('ไฟล์เวอร์ชันนี้พร้อมแล้ว');
          return;
        }
        if (q.images + q.videos > q.limit) throw Error('film_over_daily_limit');
        if (
          !confirm(
            'สร้างภาพ ' +
              q.images +
              ' ภาพ คลิป ' +
              q.videos +
              ' คลิป' +
              (q.assemble ? ' และรวมเป็น MP4' : '') +
              (q.outputUSD != null ? ' ค่าสื่อขาออกประมาณ US$' + q.outputUSD.toFixed(2) : '') +
              '? งานสร้างภาพและคลิปอาจมีค่าใช้จ่ายตามบริการที่เชื่อมไว้'
          )
        )
          return;
        body.token = preview.token;
      }
      ctx.report('กำลังส่งเข้าคิวสร้างสื่อ…');
      await ctx.api(endpoint('produce'), json('POST', {...body, auto, confirmed: true}));
      if (!ctx.live()) return;
      pending = null;
      await refresh();
      ctx.report('บันทึกคำสั่งแล้ว เปิดโปรเจกต์นี้กลับมาดูความคืบหน้าได้');
    }
    function asset(box, key, isVideo = false) {
      const saved = assets[key];
      if (!saved?.file) return;
      const {file} = saved;
      if (!saved.ready) box.append(el('small', 'ไฟล์จากการสร้างครั้งก่อน'));
      const version = drawing;
      async function display(host) {
        const response = await ctx.request(
          '/api/files/' + encodeURIComponent(file.id) + '/preview',
          {},
          true
        );
        if (!ctx.live() || version !== drawing || !host.isConnected) return;
        const blob = await response.blob();
        if (!ctx.live() || version !== drawing || !host.isConnected) return;
        const url = URL.createObjectURL(blob);
        urls.add(url);
        const media = isVideo
          ? el('video', null, {controls: '', playsinline: '', preload: 'metadata'})
          : el('img', null, {alt: file.name || 'ภาพอ้างอิง'});
        media.src = url;
        host.replaceChildren(media);
      }
      const host = el('div', null, {class: 'film-preview'});
      box.append(host);
      if (isVideo) {
        host.append(act('เล่นวิดีโอ', () => display(host)));
        box.append(
          act('ดาวน์โหลด MP4', async () => {
            const response = await ctx.request('/api/files/' + encodeURIComponent(file.id), {}, true);
            const blob = await response.blob();
            if (ctx.live()) download(blob, file.name || 'film.mp4');
          }),
          act('เปิดในไทม์ไลน์', () => window.PanthoriumCreativeStudio.editFile(file.id))
        );
      } else {
        host.append(act('ดูภาพ', () => display(host)));
        if ('IntersectionObserver' in window) {
          observer ||= new IntersectionObserver(
            (entries) =>
              entries.forEach((entry) => {
                if (entry.isIntersecting) {
                  observer.unobserve(entry.target);
                  entry.target.showFrame?.();
                }
              }),
            {rootMargin: '80px'}
          );
          host.showFrame = () =>
            display(host).catch((e) => {
              if (ctx.live() && version === drawing) ctx.report(detail(e));
            });
          observer.observe(host);
        }
      }
    }
    function card(title) {
      const box = el('section', null, {class: 'film-card'});
      box.append(el('h3', title));
      return box;
    }
    function references(type) {
      const library = type === 'character' ? p.body.characters : p.body.locations;
      const label = labels[type],
        grid = el('div', null, {class: 'film-grid'});
      ctx.panel.append(
        act('เพิ่ม' + label, () => {
          if (library.length >= 40) throw Error('เพิ่มได้สูงสุด 40 รายการ');
          library.push({
            id: uuid(),
            name: label + ' ' + (library.length + 1),
            description: '',
            referenceId: null
          });
          changed();
          draw();
        }),
        grid
      );
      for (const item of library) {
        const key = type + ':' + item.id,
          box = card(item.name);
        const upload = el('input', null, {type: 'file', accept: 'image/png,image/jpeg,image/webp'});
        upload.onchange = ctx.handle(async () => {
          try {
            const f = upload.files[0];
            if (!f) return;
            if (!['image/png', 'image/jpeg', 'image/webp'].includes(f.type) || f.size > 4 * 1024 * 1024)
              throw Error('เลือกรูป PNG, JPEG หรือ WebP ขนาดไม่เกิน 4 MB');
            const data = await ctx.request('/api/files', {
              method: 'POST',
              body: f,
              headers: {
                'Content-Type': 'application/octet-stream',
                'x-file-content-type': f.type,
                'x-file-name': encodeURIComponent(f.name)
              }
            });
            if (!ctx.live()) return;
            item.referenceId = data.file.id;
            changed();
            draw();
            ctx.report('แนบรูปต้นแบบแล้ว');
          } catch (e) {
            ctx.report(detail(e));
          }
        });
        box.append(
          editField('ชื่อ' + label, input(item.name, 64), item, 'name'),
          editField(
            type === 'character' ? 'ใบหน้า ทรงผม และเครื่องแต่งกาย' : 'สถานที่ แสง และบรรยากาศ',
            area(item.description, 400),
            item,
            'description'
          ),
          field(item.referenceId ? 'เปลี่ยนรูปต้นแบบ' : 'แนบรูปต้นแบบ (ถ้ามี)', upload)
        );
        if (item.referenceId)
          box.append(
            act('ถอดรูปต้นแบบ', () => {
              item.referenceId = null;
              changed();
              draw();
            })
          );
        asset(box, key);
        box.append(act(assets[key]?.ready ? 'สร้างภาพอ้างอิงใหม่' : 'สร้างภาพอ้างอิง', () => produce(key)));
        grid.append(box);
      }
      if (!library.length) grid.append(el('p', 'เพิ่ม' + label + 'เอง หรือให้ Gemini แยกจากเนื้อเรื่อง'));
    }
    function shots(ep, video) {
      const grid = el('div', null, {class: 'film-grid'});
      if (video) {
        const output = card(ep.title + ' · MP4');
        output.append(act('สร้างและรวมช็อตเป็น MP4', () => produce('episode:' + ep.id)));
        asset(output, 'episode:' + ep.id, true);
        ctx.panel.append(output);
        if (feature())
          ctx.panel.append(
            act('ภาพรวมและส่งออกหนังยาว', () => {
              stage = 'feature';
              draw();
            })
          );
        if (!feature() && p.body.episodes.length > 1)
          ctx.panel.append(
            act('ดาวน์โหลดทั้งเรื่องเป็น MP4', async () => {
              const name = window.PanthoriumToolsUI.fileName(p.title, '.mp4');
              let handle;
              if (typeof window.showSaveFilePicker === 'function') {
                try {
                  handle = await window.showSaveFilePicker({
                    suggestedName: name,
                    types: [{description: 'MP4', accept: {'video/mp4': ['.mp4']}}]
                  });
                } catch (e) {
                  if (e.name === 'AbortError') return;
                  if (e.name !== 'SecurityError') throw e;
                }
              }
              await save();
              ctx.report('กำลังรวมตอนตามลำดับ…');
              const response = await ctx.api(
                endpoint('master'),
                json('POST', {revision: p.revision}),
                true
              );
              if (handle && response.body)
                await response.body.pipeTo(await handle.createWritable(), {signal: ctx.signal});
              else {
                const blob = await response.blob();
                if (ctx.live()) download(blob, name);
              }
              ctx.report('ส่งออกภาพยนตร์ทั้งเรื่องแล้ว');
            })
          );
      } else
        ctx.panel.append(
          act('เพิ่มช็อต', () => {
            if (ep.shots.length >= 8) throw Error('ลำดับนี้มีครบ 8 ช็อตแล้ว');
            ep.shots.push({
              id: uuid(),
              action: 'ช็อตใหม่',
              camera: '',
              emotion: '',
              dialogue: '',
              seconds: 4,
              characterIds: [],
              locationId: null
            });
            changed();
            draw();
          })
        );
      ctx.panel.append(grid);
      ep.shots.forEach((s, i) => {
        const key = (video ? 'clip:' : 'frame:') + s.id,
          box = card('ช็อต ' + (i + 1) + ' · ' + s.seconds + ' วินาที');
        asset(box, key, video);
        if (video) box.append(el('p', s.action));
        else {
          box.append(
            editField('การกระทำในช็อต', area(s.action, 420), s, 'action'),
            editField('อารมณ์และสีหน้า', input(s.emotion, 100), s, 'emotion'),
            editField('มุมกล้องและการเคลื่อนกล้อง', input(s.camera, 150), s, 'camera'),
            editField('บทพูด', area(s.dialogue, 200), s, 'dialogue'),
            editField(
              'ความยาว',
              select(
                [4, 6, 8].map((n) => [String(n), n + ' วินาที']),
                String(s.seconds)
              ),
              s,
              'seconds',
              (c) => Number(c.value)
            ),
            editField(
              'ฉากหลัง',
              select([['', 'ไม่ระบุ'], ...p.body.locations.map((l) => [l.id, l.name])], s.locationId || ''),
              s,
              'locationId',
              (c) => c.value || null
            )
          );
          const cast = el('fieldset');
          cast.append(el('legend', 'ตัวละครในช็อต (ไม่เกิน 2 คน)'));
          for (const c of p.body.characters) {
            const cb = el('input', null, {type: 'checkbox'});
            cb.checked = s.characterIds.includes(c.id);
            cb.onchange = () => {
              if (cb.checked && s.characterIds.length >= 2) {
                cb.checked = false;
                ctx.report('เลือกตัวละครได้ไม่เกิน 2 คนต่อช็อต');
                return;
              }
              s.characterIds = cb.checked
                ? [...s.characterIds, c.id]
                : s.characterIds.filter((k) => k !== c.id);
              changed();
            };
            cast.append(field(c.name, cb));
          }
          box.append(cast);
          const move = (to) => {
            ep.shots.splice(to, 0, ...ep.shots.splice(i, 1));
            changed();
            draw();
          };
          const up = act('เลื่อนขึ้น', () => move(i - 1)),
            down = act('เลื่อนลง', () => move(i + 1));
          up.disabled = !i;
          down.disabled = i === ep.shots.length - 1;
          box.append(
            row(
              up,
              down,
              act('ลบช็อต', () => {
                if (confirm('ลบช็อตนี้จากตอนหรือไม่?')) {
                  ep.shots.splice(i, 1);
                  changed();
                  draw();
                }
              })
            )
          );
        }
        box.append(
          act(
            video
              ? assets[key]?.ready
                ? 'สร้างคลิปใหม่'
                : 'สร้างคลิปช็อตนี้'
              : assets[key]?.ready
                ? 'สร้างภาพช็อตใหม่'
                : 'สร้างภาพช็อตนี้',
            () => produce(key)
          )
        );
        grid.append(box);
      });
      if (!ep.shots.length) grid.append(el('p', 'ยังไม่มีช็อตในตอนนี้'));
    }
    list().catch((e) => {
      if (ctx.live()) ctx.report(detail(e));
    });
  }
  window.PanthoriumFilmStudio = {mount};
})();
