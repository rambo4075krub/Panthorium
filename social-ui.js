(function () {
  "use strict";
  const specs = [
    ["watch", "Watch", "ภาพและข้อความ", "▧"],
    ["short", "Short", "วิดีโอและ Reels", "▶"],
    ["live", "Live", "ถ่ายทอดสด", "◉"],
    ["market", "Market", "ร้านค้า", "▣"],
    ["community", "Community", "แชตกลุ่ม", "◌"],
    ["talk", "Talk", "แชตส่วนตัว", "☏"],
    ["connect", "Connect", "หาคู่ 18+", "♡"],
    ["profile", "Profile", "โปรไฟล์ส่วนตัว", "◯"],
    ["friends", "Add Friends", "ค้นหาเพื่อน", "+"],
  ];
  const WINDOW_ID = "social-media";
  let workspace;
  const views = new Map();
  const os = () => (typeof OS !== "undefined" ? OS : window.OS);
  const uid = () =>
    String(os()?.state?.user?.sub || os()?.state?.user?.id || "");
  const allowed = () =>
    !!uid() &&
    !os()?.state?.user?.roles?.includes("guest") &&
    os()?.state?.user?.permissions?.includes("chat");
  const current = (v) =>
    allowed() &&
    uid() === v.uid &&
    v.root.isConnected &&
    !v.controller.signal.aborted;
  const el = (tag, text, attrs = {}) => {
    const n = document.createElement(tag);
    if (text != null) n.textContent = text;
    for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v);
    return n;
  };
  const messages = {
    social_profile_required: "กรุณาบันทึกโปรไฟล์ก่อน",
    social_adult_consent_required:
      "Connect ต้องยืนยันอายุ 18 ปีขึ้นไปและสมัครใจเปิดใช้",
    social_support_unavailable: "แชทแอดมินยังไม่พร้อมใช้งาน กรุณาติดต่อ account@panthorium.net",
    social_support_blocked: "ไม่สามารถเปิดแชทนี้ได้ กรุณาตรวจบัญชีที่บล็อกหรือติดต่อ account@panthorium.net",
    social_thread_not_accepted: "รออีกฝ่ายรับคำขอสนทนาก่อน",
    social_join_required: "กรุณาเข้าร่วมกลุ่มก่อนส่งข้อความหรือไฟล์",
    social_group_capacity: "กลุ่มนี้มีสมาชิกครบ 200 คนแล้ว",
    social_group_owner_required: "ผู้สร้างกลุ่มต้องอยู่ในกลุ่มเพื่อดูแลสมาชิก",
    social_group_request_not_pending: "คำขอนี้ได้รับการจัดการแล้ว กรุณารีเฟรชกลุ่ม",
    social_invalid_group_privacy: "กรุณาเลือกกลุ่มแบบเปิดหรือแบบปิด",
    social_match_required: "ต้องสนใจตรงกันก่อนเริ่มคุย",
    social_not_found: "ไม่พบรายการหรือไม่มีสิทธิ์เข้าถึง",
    files_quota_exceeded: "พื้นที่คลาวด์เต็ม กรุณาจัดการไฟล์หรือแพ็กเกจ",
    file_too_large: "ไฟล์เกินขนาดที่ระบบรองรับ 20 MB",
    social_video_required: "Short ต้องแนบวิดีโอ MP4 หรือ WebM",
    social_watch_images_only: "Watch รองรับภาพและข้อความ กรุณาโพสต์วิดีโอใน Short",
    social_image_required: "โปรไฟล์รองรับรูป PNG, JPEG, WebP หรือ GIF",
    social_forbidden: "คุณไม่มีสิทธิ์ดำเนินการกับรายการนี้",
    social_friend_request_not_pending: "คำขอนี้ได้รับการจัดการแล้ว กรุณารีเฟรช",
    social_invitation_not_pending: "คำขอนี้ได้รับการจัดการแล้ว กรุณารีเฟรช",
    social_live_capacity: "ห้องนี้ครบจำนวนผู้ชม 8 คนแล้ว",
    social_invalid_order: "จำนวนสินค้าไม่พอหรือรายการไม่พร้อมขาย",
    social_connect_disabled: "ฝ่ายใดฝ่ายหนึ่งปิด Connect แล้ว",
    social_name_required: "กรุณาระบุชื่อที่แสดง",
    social_invalid_product: "ตรวจราคาและจำนวนสินค้า",
  };
  const friendly = (e) =>
    messages[e.message] || e.message || "ดำเนินการไม่สำเร็จ";
  function status(v, text) {
    if (current(v)) {
      const target = v.status || views.get(workspace?.active)?.status;
      if (target) target.textContent = text;
    }
  }
  async function api(v, path, options = {}, raw = false) {
    if (!current(v)) throw Error("account_changed");
    const send = () =>
      fetch(String(os()?.config?.backendUrl || "").replace(/\/$/, "") + path, {
        ...options,
        credentials: "include",
        cache: "no-store",
        signal: v.controller.signal,
        headers: {
          ...(os()?.config?.accessToken
            ? { Authorization: "Bearer " + os().config.accessToken }
            : {}),
          ...(options.body ? { "Content-Type": "application/json" } : {}),
          ...options.headers,
        },
      });
    let res = await send();
    if (
      res.status === 401 &&
      current(v) &&
      window.PanthoriumAuth?.refreshSession
    ) {
      await window.PanthoriumAuth.refreshSession();
      if (!current(v)) throw Error("account_changed");
      res = await send();
    }
    if (!current(v)) throw Error("account_changed");
    if (raw) {
      if (!res.ok)
        throw Error((await res.json()).error || "social_media_unavailable");
      return res.blob();
    }
    const data = await res.json();
    if (!res.ok || data.ok === false)
      throw Error(data.error || "social_request_failed");
    return data;
  }
  const write = async (v, action, input, requestId = crypto.randomUUID()) => {
    const result = await api(v, "/api/social/actions", {
      method: "POST",
      headers: { "Idempotency-Key": requestId },
      body: JSON.stringify({ action, input }),
    });
    if (!["signal", "live-heartbeat", "call-heartbeat"].includes(action)) refreshNotifications();
    return result;
  };
  function button(v, text, fn) {
    const b = el("button", text, { type: "button" });
    b.addEventListener("click", async () => {
      if (!current(v) || b.disabled) return;
      b.disabled = true;
      try {
        await fn();
      } catch (e) {
        status(v, friendly(e));
      } finally {
        b.disabled = false;
      }
    });
    return b;
  }
  function input(form, label, type = "text", value = "") {
    const wrap = el("label", label),
      n = el(type === "textarea" ? "textarea" : "input");
    if (type !== "textarea") n.type = type;
    n.value = value;
    wrap.append(n);
    form.append(wrap);
    return n;
  }
  function select(form, label, options, value) {
    const wrap = el("label", label),
      s = el("select", null, { "aria-label": label });
    for (const [id, name] of options)
      s.append(el("option", name, { value: id }));
    if (value) s.value = value;
    wrap.append(s);
    form.append(wrap);
    return s;
  }
  function section(v, title) {
    const n = el("section", null, { class: "social-card" });
    n.append(el("h3", title));
    v.content.append(n);
    return n;
  }
  function clear(v) {
    v.readObserver?.disconnect();
    clearTimeout(v.readTimer);
    v.readSeen = new Set();
    v.messageRender = (v.messageRender || 0) + 1;
    v.lastMessages = null;
    v.messageLog = null;
    v.groupState = null;
    v.groupItems = null;
    v.groupCursor = null;
    v.detail = null;
    v.refreshFriends = null;
    for (const url of v.urls) URL.revokeObjectURL(url);
    v.urls.clear();
    v.content.replaceChildren();
  }
  function change(v, fn) {
    v.detail = null;
    clear(v);
    return fn();
  }
  function bindForm(v, form, action, data, after) {
    const sending = ["message", "group-message", "live-chat", "comment"].includes(action);
    const submit = el("button", sending ? "ส่ง" : action === "group-create" ? "สร้างกลุ่ม" : "บันทึก", { type: "submit" });
    form.append(submit);
    let requestId = crypto.randomUUID();
    form.addEventListener("input", () => {
      requestId = crypto.randomUUID();
    });
    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      if (submit.disabled) return;
      submit.disabled = true;
      try {
        const out = await write(v, action, await data(), requestId);
        status(v, sending ? "ส่งแล้ว" : "บันทึกแล้ว");
        requestId = crypto.randomUUID();
        if (after) await after(out);
      } catch (e) {
        status(v, friendly(e));
      } finally {
        submit.disabled = false;
      }
    });
    return submit;
  }
  async function attachments(v, form, initial = []) {
    const details = el("details"),
      summary = el("summary", "แนบไฟล์จากคลาวด์ / อัปโหลด"),
      list = el("div");
    details.append(summary, list);
    form.append(details);
    const selected = new Set(initial);
    const render = async () => {
      list.replaceChildren();
      const data = await api(v, "/api/files");
      if (!current(v)) return;
      list.append(
        el(
          "p",
          `พื้นที่ ${Math.round(data.usedBytes / 1048576)} / ${Math.round(data.maxBytes / 1048576)} MB · แชร์ไฟล์เดิม ไม่ทำสำเนา`,
        ),
      );
      for (const f of data.files || []) {
        const label = el("label", f.name),
          check = el("input");
        check.type = "checkbox";
        check.checked = selected.has(f.id);
        check.onchange = () => {
          if (check.checked && selected.size >= 6) {
            check.checked = false;
            status(v, "แนบได้สูงสุด 6 ไฟล์");
            return;
          }
          check.checked ? selected.add(f.id) : selected.delete(f.id);
          form.dispatchEvent(new Event("input", { bubbles: true }));
        };
        label.prepend(check);
        list.append(label);
      }
    };
    const upload = input(details, "อัปโหลดเข้าพื้นที่ของฉัน", "file");
    details.append(
      button(v, "อัปโหลดไฟล์", async () => {
        const file = upload.files[0];
        if (!file) return;
        if (file.size > 20 * 1024 * 1024) throw Error("file_too_large");
        const result = await api(v, "/api/files", {
          method: "POST",
          headers: {
            "Content-Type": "application/octet-stream",
            "X-File-Name": encodeURIComponent(file.name),
            "X-File-Content-Type": file.type || "application/octet-stream",
          },
          body: file,
        });
        if (selected.size < 6) selected.add(result.file.id);
        form.dispatchEvent(new Event("input", { bubbles: true }));
        await render();
      }),
    );
    let loaded = false;
    details.addEventListener("toggle", () => {
      if (details.open && !loaded) {
        loaded = true;
        render().catch((e) => {
          loaded = false;
          status(v, friendly(e));
        });
      }
    });
    const getFiles = () => [...selected];
    getFiles.reset = () => {
      selected.clear();
      list.querySelectorAll('input[type="checkbox"]').forEach(node => { node.checked = false; });
      upload.value = "";
    };
    return getFiles;
  }
  async function media(v, record, container) {
    for (const file of record.files || []) {
      const item = el("div", null, { class: "social-media" });
      item.append(el("small", file.name));
      const preview = el("div");
      item.append(preview);
      container.append(item);
      const show = async () => {
        const blob = await api(v, "/api/social/records/" +
          encodeURIComponent(record.id) + "/files/" + encodeURIComponent(file.id), {}, true);
        if (!current(v) || !item.isConnected) return;
        let view;
        if (/^image\/(png|jpeg|webp|gif)$/.test(blob.type) || /^(video|audio)\//.test(blob.type)) {
          const url = URL.createObjectURL(blob);
          v.urls.add(url);
          view = blob.type.startsWith("image")
            ? el("img", null, { alt: file.name, src: url })
            : el(blob.type.startsWith("video") ? "video" : "audio", null,
                { src: url, controls: "", playsinline: "", preload: "metadata" });
        } else {
          view = el("pre", await blob.text());
          if (!current(v) || !item.isConnected) return;
        }
        preview.replaceChildren(view);
      };
      if (["watch", "short", "listing", "connect"].includes(record.kind) || (record.kind === "group-message" && /^(image\/(png|jpeg|webp|gif)|video\/|audio\/)/.test(file.contentType))) {
        preview.textContent = "กำลังโหลดสื่อ…";
        // Load independently so a slow attachment never blocks the feed or its controls.
        show().catch(() => {
          if (!current(v) || !item.isConnected) return;
          preview.replaceChildren(el("p", "โหลดสื่อไม่สำเร็จ"), button(v, "ลองโหลดอีกครั้ง", show));
        });
      } else {
        preview.append(button(v, "เปิดไฟล์ / ดูตัวอย่าง", show));
      }
      item.append(
        button(v, "ดาวน์โหลดต้นฉบับ", async () => {
          const blob = await api(
            v,
            "/api/social/records/" +
              encodeURIComponent(record.id) +
              "/files/" +
              file.id +
              "?download=1",
            {},
            true,
          );
          if (!current(v)) return;
          const url = URL.createObjectURL(blob);
          v.urls.add(url);
          const a = el("a", "ดาวน์โหลด", { href: url, download: file.name });
          item.append(a);
          a.click();
        }),
      );
      container.append(item);
    }
  }
  async function profile(v) {
    clear(v);
    const data = await api(v, "/api/social/profile");
    if (!current(v)) return;
    const f = section(v, "โปรไฟล์ส่วนตัว"),
      form = el("form");
    f.append(form);
    const name = input(form, "ชื่อที่แสดง", "text", data.profile?.name || ""),
      bio = input(form, "เกี่ยวกับฉัน", "textarea", data.profile?.bio || ""),
      visible = input(
        form,
        "อนุญาตให้ค้นหาชื่อของฉันและส่งคำขอเป็นเพื่อน",
        "checkbox",
      );
    visible.checked = !!data.profile?.discoverable;
    name.maxLength = 80;
    bio.maxLength = 1000;
    const getFiles = await attachments(v, form, (data.profile?.files || []).map(file => file.id));
    form.append(el("p", "แนบรูปโปรไฟล์ได้ ข้อมูลและรูปในหน้านี้เปิดดูได้เฉพาะคุณ"));
    bindForm(
      v,
      form,
      "profile",
      () => ({
        name: name.value,
        bio: bio.value,
        discoverable: visible.checked,
        fileIds: getFiles(),
      }),
      () => profile(v),
    );
    f.append(
      el(
        "p",
        "ชื่อที่แสดงใช้กำกับโพสต์และข้อความ ส่วนข้อมูลโปรไฟล์และรูปจะไม่เผยแพร่ หากเปิดการซิงค์ Connect จะแชร์เฉพาะข้อมูลที่ยินยอมไว้ใน Connect",
      ),
    );
    if (os()?.state?.user?.roles?.includes("administrator"))
      f.append(
        button(v, "รายการรายงานเนื้อหา", async () => {
          const r = await api(v, "/api/social/reports");
          const target = section(v, "รายงาน");
          for (const report of r.items) {
            const c = el("div");
            c.append(
              el("p", report.reason),
              el("small", report.targetId),
              button(v, "ซ่อนรายการนี้", async () => {
                await write(v, "moderate", {
                  recordId: report.targetId,
                  hidden: true,
                  reason: report.reason,
                });
                status(v, "ซ่อนรายการแล้ว");
              }),
            );
            target.append(c);
          }
        }),
      );
  }
  async function compose(v) {
    clear(v);
    const card = section(
        v,
        v.module === "market" ? "ลงสินค้า" : "เผยแพร่ " + v.module,
      ),
      form = el("form");
    card.append(form);
    const title = input(form, "ชื่อเรื่อง", "text"),
      text = input(form, "รายละเอียด", "textarea"),
      audience = select(form, "ผู้ที่ดูได้", [
        ["public", "ผู้ใช้ที่เข้าสู่ระบบ"],
        ["followers", "ผู้ติดตาม"],
        ["private", "เฉพาะฉัน"],
      ]);
    title.maxLength = 200;
    text.maxLength = 8000;
    let price, stock;
    if (v.module === "market") {
      price = input(form, "ราคา (บาท)", "number");
      price.min = 0;
      price.step = "0.01";
      stock = input(form, "จำนวนสินค้า", "number", "1");
      stock.min = 1;
    }
    if (["watch", "short", "market"].includes(v.module)) { audience.value = "public"; audience.disabled = true; form.append(el("p", v.module === "short" ? "วิดีโอสั้น ยาว และ Reels • สาธารณะ" : v.module === "watch" ? "ภาพและข้อความเท่านั้น • สาธารณะ" : "ร้านค้าสาธารณะ")); }
    const groupId = v.groupId;
    v.groupId = null;
    if (groupId) {
      audience.value = "private";
      audience.disabled = true;
      form.append(el("p", "โพสต์นี้มองเห็นเฉพาะสมาชิกกลุ่ม"));
    }
    const getFiles = await attachments(v, form, v.sourceFileIds || []);
    v.sourceFileIds = [];
    const submit = bindForm(
      v,
      form,
      v.module === "market" ? "listing" : "publish",
      () => ({
        module: v.module,
        title: title.value,
        text: text.value,
        audience: groupId ? "group" : audience.value,
        ...(groupId ? { groupId } : {}),
        fileIds: getFiles(),
        ...(price
          ? {
              priceSatang: Math.round(Number(price.value) * 100),
              stock: Number(stock.value),
            }
          : {}),
      }),
      () => groupId ? detail(v, groupId) : feed(v),
    );
    submit.textContent = v.module === "market" ? "ลงสินค้า" : "เผยแพร่";
  }
  function friendActions(v, person, parent, reload) {
    const relation = person.friendship;
    if (relation?.status === "accepted") {
      parent.append(el("small", "เป็นเพื่อนกันแล้ว"), button(v, "ส่งข้อความ", async () => {
        const out = await write(v, "thread", { userId: person.id }); await open("talk", { recordId: out.record.id });
      }), button(v, "เลิกเป็นเพื่อน", async () => {
        if (!window.confirm("เลิกเป็นเพื่อนกับ " + person.name + "?")) return;
        await write(v, "friend-remove", { recordId: relation.id }); await reload();
      }));
    } else if (relation?.status === "pending") {
      if (relation.direction === "incoming") for (const [text, accept] of [["รับคำขอเป็นเพื่อน", true], ["ปฏิเสธ", false]])
        parent.append(button(v, text, async () => { await write(v, "friend-review", { recordId: relation.id, accept }); await reload(); }));
      else parent.append(el("small", "ส่งคำขอเป็นเพื่อนแล้ว"), button(v, "ยกเลิกคำขอ", async () => { await write(v, "friend-cancel", { recordId: relation.id }); await reload(); }));
    } else parent.append(button(v, "เพิ่มเพื่อน", async () => { await write(v, "friend-request", { userId: person.id }); await reload(); }));
    parent.append(button(v, "บล็อก", async () => { await write(v, "block", { userId: person.id, enabled: true }); await reload(); }));
  }
  async function people(v) {
    clear(v);
    const card = section(v, "ค้นหาเพื่อน"), form = el("form"), q = input(form, "ชื่อที่แสดงอย่างน้อย 2 ตัวอักษร"), results = el("div");
    card.append(el("p", "ค้นหาได้เฉพาะชื่อที่เจ้าของอนุญาต หน้าโปรไฟล์และข้อมูลส่วนตัวยังคงเป็นส่วนตัว"), form, results);
    const submit = el("button", "ค้นหาเพื่อน", { type: "submit" }); form.append(submit);
    const contacts = el("section", null, { "data-social-friends": "" }); v.content.append(contacts);
    const renderPerson = (p, parent, reload) => {
      const row = el("article", null, { class: "social-card", "data-friend-id": p.id }); row.append(el("h4", p.name));
      friendActions(v, p, row, reload); parent.append(row);
    };
    const search = async () => {
      const data = await api(v, "/api/social/people?query=" + encodeURIComponent(q.value));
      if (!current(v) || !results.isConnected) return;
      results.replaceChildren();
      for (const person of data.items) renderPerson(person, results, async () => { await search(); await v.refreshFriends?.(); });
      if (!data.items.length) results.append(el("p", "ไม่พบชื่อที่อนุญาตให้ค้นหา"));
    };
    form.onsubmit = async event => { event.preventDefault(); submit.disabled = true; try { await search(); } catch (error) { status(v, friendly(error)); } finally { submit.disabled = false; } };
    v.refreshFriends = async (before) => {
      const data = await api(v, "/api/social/friends" + (before ? "?before=" + encodeURIComponent(before) : ""));
      if (!current(v) || !contacts.isConnected) return;
      if (!before) contacts.replaceChildren(el("h3", "เพื่อนและคำขอเป็นเพื่อน"));
      if (!data.items.length && !before) contacts.append(el("p", "ยังไม่มีเพื่อนหรือคำขอ"));
      for (const relation of data.items) renderPerson({ id: relation.userId, name: relation.name, friendship: relation }, contacts, () => v.refreshFriends());
      if (data.nextCursor) contacts.append(button(v, "โหลดเพื่อนเพิ่มเติม", async () => { await v.refreshFriends(data.nextCursor); }));
    };
    await v.refreshFriends();
  }
  function inlineComments(v, record, parent, initial) {
    const section = el("section", null, {
      class: "social-comments", "data-social-comments": record.id,
      "aria-label": "ความคิดเห็นใต้โพสต์",
    });
    const log = el("div", "กำลังโหลดความคิดเห็น…", { "data-social-messages": record.id });
    const form = el("form", null, { "data-social-comment-form": record.id });
    const text = input(form, "เขียนความคิดเห็น", "textarea");
    text.setAttribute("data-social-comment-input", "");
    text.required = true;
    text.maxLength = 2000;
    section.append(el("h4", "ความคิดเห็น"), log, form);
    parent.append(section);
    let version = 0, items = [];
    const active = () => current(v) && section.isConnected;
    const render = (data, older = false) => {
      if (!active()) return;
      items = older ? [...data.items, ...items] : data.items;
      log.replaceChildren();
      if (data.nextCursor)
        log.append(button(v, "ดูความคิดเห็นก่อนหน้า", () => load(data.nextCursor)));
      if (!items.length) log.append(el("p", "ยังไม่มีความคิดเห็น"));
      for (const comment of items) {
        const row = el("article", null, { class: "social-message", "data-comment-id": comment.id });
        row.append(
          el("small", (comment.ownerId === v.uid ? "คุณ" : comment.author?.name || "สมาชิก") +
            " • " + new Date(comment.createdAt).toLocaleString("th-TH")),
          el("p", comment.text),
        );
        log.append(row);
      }
    };
    const load = async (before) => {
      const request = ++version;
      try {
        const data = await api(v, "/api/social/records/" + encodeURIComponent(record.id) +
          (before ? "?before=" + encodeURIComponent(before) : ""));
        if (active() && request === version) render(data, !!before);
      } catch (error) {
        if (!active() || request !== version) return;
        log.replaceChildren(el("p", "โหลดความคิดเห็นไม่สำเร็จ: " + friendly(error)),
          button(v, "ลองโหลดความคิดเห็นอีกครั้ง", () => load()));
      }
    };
    bindForm(v, form, "comment", () => ({ recordId: record.id, text: text.value }), async () => {
      if (!active()) return;
      text.value = "";
      await load();
    });
    if (initial) render(initial);
    else load();
  }
  async function card(v, r, parent, commentData) {
    const c = el("article", null, {
      class: "social-card",
      "data-record-id": r.id,
    });
    parent.append(c);
    c.append(
      el("small", r.author?.name || "สมาชิก"),
      el("h3", r.title || r.name || (r.kind === "thread" ? "Talk" : r.module === "short" || r.kind === "short" ? "วิดีโอ" : "โพสต์")),
      el("p", r.text || r.bio || ""),
    );
    if (r.kind === "thread") {
      c.append(
        el("p", r.status === "pending" ? "รอรับคำขอสนทนา" : r.status),
        button(v, "เปิดบทสนทนา", () => detail(v, r.id)),
      );
      return;
    }
    if (r.kind === "connect") {
      await media(v, r, c);
      c.append(
        button(v, "สนใจ", async () => {
          await write(v, "interest", { userId: r.ownerId });
          await feed(v);
        }),
        button(v, "ผ่าน", async () => {
          await write(v, "pass", { userId: r.ownerId });
          c.remove();
        }),
      );
      if (r.matched)
        c.append(
          button(v, "ตรงกันแล้ว • เริ่มคุย", async () => {
            const t = await write(v, "thread", {
              userId: r.ownerId,
              context: "connect",
            });
            await open("connect", { recordId: t.record.id });
          }),
        );
    } else if (r.kind === "live") {
      c.append(
        button(v, "เข้าชมไลฟ์", async () => {
          const out = await write(v, "live-join", { recordId: r.id });
          await startRTC(v, out.record);
          await detail(v, r.id, false);
        }),
      );
    } else {
      await media(v, r, c);
      if (r.kind === "listing") {
        c.append(
          el(
            "strong",
            (r.priceSatang / 100).toLocaleString("th-TH") +
              " บาท • คงเหลือ " +
              r.stock,
          ),
        );
        if (r.ownerId !== v.uid) {
          const qty = input(c, "จำนวน", "number", "1");
          qty.min = 1;
          c.append(
            button(v, "ส่งคำขอสั่งซื้อ", async () => {
              if (
                !window.confirm(
                  "ส่งคำขอสั่งซื้อ " +
                    r.title +
                    " จำนวน " +
                    qty.value +
                    "? ยังไม่มีการตัดเงิน",
                )
              )
                return;
              await write(v, "order", {
                recordId: r.id,
                quantity: Number(qty.value),
              });
              status(v, "ส่งคำขอสั่งซื้อแล้ว เปิดรายการซื้อขายเพื่อติดตาม");
            }),
          );
        }
      }
      c.append(
        button(
          v,
          (r.liked ? "♥" : "♡") + " " + (r.likeCount || 0),
          async () => {
            await write(v, "like", { recordId: r.id });
            await feed(v);
          },
        ),
        button(v, "ความคิดเห็น", () => c.querySelector("[data-social-comment-input]")?.focus()),
      );
    }
    if (r.module === "short" || r.kind === "short")
      c.append(
        button(v, "เพิ่มลงเพลย์ลิสต์", () => collections(v, "playlist", r.id)),
      );
    if (
      r.ownerId === v.uid &&
      ["community", "watch", "short", "listing"].includes(r.kind)
    )
      c.append(button(v, "แก้ไข", () => edit(v, r)));
    if (
      r.ownerId === v.uid &&
      ["community", "watch", "short", "listing"].includes(r.kind)
    )
      c.append(
        button(v, "ลบ", async () => {
          if (!window.confirm("ลบรายการนี้? ไฟล์ต้นฉบับยังอยู่ในพื้นที่ของคุณ"))
            return;
          await write(v, "delete", { recordId: r.id });
          await feed(v);
        }),
      );
    if (r.ownerId !== v.uid) {
      if (r.kind !== "connect") c.append(
        button(v, "ขอสนทนากับเจ้าของ", async () => {
          const t = await write(v, "thread", {
            userId: r.ownerId,
            title: r.title || "Talk",
          });
          await open("talk", { recordId: t.record.id });
        }),
      );
      c.append(
        button(v, "บล็อกเจ้าของ", async () => {
          await write(v, "block", { userId: r.ownerId, enabled: true });
          await feed(v);
        }),
      );
      const reportForm = el("div");
      reportForm.hidden = true;
      const reason = input(reportForm, "เหตุผลที่รายงาน", "textarea");
      const reportButton = button(v, "รายงาน", () => {
        reportForm.hidden = false;
        reportButton.setAttribute("aria-expanded", "true");
        reason.focus();
      });
      reportButton.setAttribute("aria-expanded", "false");
      const closeReport = () => {
        reportForm.hidden = true;
        reportButton.setAttribute("aria-expanded", "false");
        reportButton.focus();
      };
      reportForm.append(
        button(v, "ส่งรายงาน", async () => {
          if (!reason.value.trim()) { reason.focus(); return; }
          await write(v, "report", { recordId: r.id, reason: reason.value.trim() });
          reason.value = "";
          closeReport();
          status(v, "ส่งรายงานให้ผู้ดูแลแล้ว");
        }),
        button(v, "ยกเลิก", closeReport),
      );
      c.append(reportButton, reportForm);
    }
    const tools = el("details", null, { class: "social-record-tools" });
    tools.append(el("summary", "เครื่องมือของรายการ")); c.append(tools);
    tools.append(
      button(v, "นำไปใช้กับ Sentinel", async () => {
        await window.PanthoriumVoiceCommands?.windowAction("open_sentinel");
        const field = document.getElementById("chat-input");
        if (field) {
          field.value =
            "ช่วยสรุปรายการ Social Media รหัส " +
            r.id +
            " และเสนอสิ่งที่ทำต่อได้ โดยอ่านข้อมูลผ่าน social.read ก่อน";
          field.dispatchEvent(new Event("input", { bubbles: true }));
          field.focus();
        }
      }),
    );
    tools.append(
      button(v, "คัดลอกลิงก์รายการ", async () => {
        await navigator.clipboard.writeText(
          location.origin +
            location.pathname +
            "#social=" +
            v.module +
            "&record=" +
            encodeURIComponent(r.id),
        );
        status(v, "คัดลอกลิงก์แล้ว ผู้เปิดต้องมีสิทธิ์เข้าถึง");
      }),
      button(v, "นำไปวางแผนในปฏิทิน", () =>
        window.PanthoriumCalendar?.command({
          action: "new_event",
          title: r.title || r.name || "นัดหมายจาก Social Media",
        }),
      ),
    );
    if (["watch", "short", "community", "listing"].includes(r.kind))
      inlineComments(v, r, c, commentData);
  }
  async function detail(v, id, reset = true) {
    if (reset) clear(v);
    v.detail = id;
    const data = await api(v, "/api/social/records/" + encodeURIComponent(id));
    if (!current(v) || v.detail !== id) return;
    const r = data.record;
    if (r.module && r.module !== v.module && ["watch", "short", "community", "listing", "thread", "live"].includes(r.kind)) {
      v.detail = null;
      return open(r.module, { recordId: id });
    }
    if (["watch", "short", "community", "listing"].includes(r.kind)) {
      await window.PanthoriumSocial.renderCard(v, r, v.content, data);
      return;
    }
    const card = section(v, r.title || "บทสนทนา");
    if (r.kind === "thread" && r.status === "pending") {
      card.append(el("p", "คำขอสนทนา • ยังส่งข้อความหรือโทรไม่ได้"));
      if (r.ownerId !== v.uid)
        card.append(
          button(v, "รับคำขอ", async () => {
            await write(v, "accept-thread", { recordId: id, accept: true });
            await detail(v, id);
          }),
          button(v, "ปฏิเสธ", async () => {
            await write(v, "accept-thread", { recordId: id, accept: false });
            await feed(v);
          }),
        );
      return;
    }
    if (r.kind === "group") return groupDetail(v, data, card);
    if (r.kind === "playlist") {
      for (const post of data.items) {
        await window.PanthoriumSocial.renderCard(v, post, card);
        card.append(
          button(v, "นำออกจากเพลย์ลิสต์", async () => {
            await write(v, "playlist-remove", {
              recordId: r.id,
              targetId: post.id,
            });
            await detail(v, r.id);
          }),
        );
      }
      return;
    }
    if (r.kind === "thread")
      card.append(
        button(v, "โทรด้วยเสียง", () => call(v, r, false)),
        button(v, "วิดีโอคอล", () => call(v, r, true)),
      );
    const log = el("div", null, { "data-social-messages": id });
    card.append(log);
    if (["thread", "live"].includes(r.kind)) {
      v.messageLog = log;
      v.lastMessages = JSON.stringify(data.items.map(x => [x.id, x.deleted, x.readAt, x.author?.name]));
    }
    await renderMessages(v, data.items, log);
    if (
      r.kind === "thread" ||
      r.kind === "live" ||
      ["community", "watch", "short", "listing"].includes(r.kind)
    ) {
      const f = el("form"),
        text = input(
          f,
          r.kind === "thread" ? "ข้อความ" : "ความคิดเห็น",
          "textarea",
        );
      card.append(f);
      const getFiles = r.kind === "thread" ? await attachments(v, f) : () => [];
      bindForm(
        v,
        f,
        r.kind === "thread"
          ? "message"
          : r.kind === "live"
            ? "live-chat"
            : "comment",
        () => ({ recordId: id, text: text.value, fileIds: getFiles() }),
        async () => {
          text.value = "";
          const fresh = await api(
            v,
            "/api/social/records/" + encodeURIComponent(id),
          );
          await renderMessages(v, fresh.items, log);
        },
      );
    }
  }
  const messageFingerprint = items => JSON.stringify(items.map(x => [x.id, x.deleted, x.readAt, x.readCount, x.author?.name]));
  function groupRequests(v, requests) {
    const panel = v.groupState?.requests;
    if (!panel?.isConnected) return;
    const signature = JSON.stringify(requests);
    if (v.groupState.requestSignature === signature) return;
    v.groupState.requestSignature = signature;
    const groupId = v.detail;
    panel.replaceChildren(el("h4", "คำขอเข้าร่วมกลุ่ม (" + requests.length + ")"));
    if (!requests.length) panel.append(el("p", "ยังไม่มีคำขอรออนุมัติ"));
    for (const request of requests) {
      const row = el("article", null, { class: "social-card", "data-group-request": request.userId });
      row.append(el("strong", request.name), el("p", new Date(request.requestedAt).toLocaleString("th-TH")));
      for (const [label, accept] of [["อนุมัติ", true], ["ไม่อนุมัติ", false]])
        row.append(button(v, label, async () => {
          await write(v, "group-review", { recordId: groupId, userId: request.userId, accept });
          if (v.groupState?.requests !== panel) return;
          const fresh = await api(v, "/api/social/records/" + encodeURIComponent(groupId));
          if (v.groupState?.requests !== panel) return;
          groupRequests(v, fresh.requests || []);
          v.groupState.summary.textContent = groupSummary(fresh.record);
        }));
      panel.append(row);
    }
  }
  const groupSummary = r => (r.privacy === "closed" ? "กลุ่มปิด • ผู้สร้างอนุมัติการเข้าร่วม" : "กลุ่มเปิด • เข้าร่วมได้ทันที") + " • สมาชิก " + r.memberCount + " คน";
  async function groupMessages(v, data, older = false) {
    const log = v.messageLog;
    if (!current(v) || !v.groupState || !log?.isConnected) return;
    if (!v.groupItems) v.groupItems = new Map();
    // Keep older loaded history, but replace the refreshed page so removed/blocked messages disappear.
    if (!older) {
      const first = data.items[0]?.id;
      for (const id of v.groupItems.keys()) if (!first || id >= first) v.groupItems.delete(id);
    }
    for (const item of data.items) v.groupItems.set(item.id, item);
    if (older || !v.groupState.historyLoaded) v.groupCursor = data.nextCursor;
    if (older) v.groupState.historyLoaded = true;
    const items = [...v.groupItems.values()].sort((a, b) => a.id.localeCompare(b.id));
    const fingerprint = messageFingerprint(items);
    if (v.lastMessages !== fingerprint) {
      v.lastMessages = fingerprint;
      await renderMessages(v, items, log);
    }
    if (!current(v) || v.messageLog !== log || !v.groupState) return;
    v.groupState.older.hidden = !v.groupCursor;
    v.groupState.empty.hidden = !!items.length;
    scheduleRead(v);
  }
  async function groupDetail(v, data, card) {
    const r = data.record;
    const summary = el("p", groupSummary(r));
    card.append(summary, el("p", r.text || ""));
    v.groupState = { membership: r.membership, summary };
    card.append(button(v, "กลับไปกลุ่มทั้งหมด", () => collections(v, "group")));
    if (r.membership !== "member") {
      card.append(el("p", r.membership === "pending" ? "ส่งคำขอแล้ว รอผู้สร้างกลุ่มอนุมัติ" :
        r.membership === "declined" ? "คำขอก่อนหน้ายังไม่ได้รับอนุมัติ คุณสามารถส่งคำขอใหม่ได้" :
        "เข้าร่วมกลุ่มเพื่ออ่านแชตและแชร์ข้อความ รูปภาพ วิดีโอ และไฟล์"));
      card.append(button(v, r.membership === "pending" ? "ยกเลิกคำขอ" : r.privacy === "closed" ? "ขอเข้าร่วมกลุ่ม" : "เข้าร่วมกลุ่ม", async () => {
        await write(v, r.membership === "pending" ? "group-cancel-request" : "group-join", { recordId: r.id });
        await detail(v, r.id);
      }));
      return;
    }
    if (r.ownerId === v.uid) {
      card.append(el("p", "คุณเป็นผู้สร้างกลุ่ม"));
      const requests = el("section", null, { "data-group-requests": "" });
      card.append(requests);
      v.groupState.requests = requests;
      groupRequests(v, data.requests || []);
    } else card.append(button(v, "ออกจากกลุ่ม", async () => {
      await write(v, "group-leave", { recordId: r.id });
      await detail(v, r.id);
    }));
    card.append(el("h4", "แชตกลุ่ม"));
    const older = button(v, "โหลดข้อความก่อนหน้า", async () => {
      const log = v.messageLog, id = r.id;
      const previous = await api(v, "/api/social/records/" + encodeURIComponent(id) + "?before=" + encodeURIComponent(v.groupCursor));
      if (v.detail === id && v.messageLog === log) await groupMessages(v, previous, true);
    });
    const empty = el("p", "ยังไม่มีข้อความ เริ่มสนทนาในกลุ่มได้เลย");
    const log = el("div", null, { "data-social-messages": r.id, "aria-label": "ข้อความในกลุ่ม" });
    card.append(older, empty, log);
    Object.assign(v.groupState, { older, empty });
    v.messageLog = log;
    await groupMessages(v, data);
    const form = el("form", null, { "data-group-composer": "" });
    card.append(form);
    const text = input(form, "ข้อความในกลุ่ม", "textarea"); text.maxLength = 8000;
    const getFiles = await attachments(v, form, v.sourceFileIds || []);
    v.sourceFileIds = [];
    bindForm(v, form, "group-message", () => ({ recordId: r.id, text: text.value, fileIds: getFiles() }), async () => {
      if (v.detail !== r.id || v.messageLog !== log) return;
      text.value = ""; getFiles.reset();
      const fresh = await api(v, "/api/social/records/" + encodeURIComponent(r.id));
      if (v.detail === r.id && v.messageLog === log) await groupMessages(v, fresh);
    });
    // Existing group posts stay available alongside the new conversation.
    const posts = el("details"); posts.append(el("summary", "โพสต์ในกลุ่ม (" + (data.posts || []).length + ")")); card.append(posts);
    posts.append(button(v, "โพสต์ในกลุ่ม", async () => { v.groupId = r.id; await compose(v); }));
    for (const post of data.posts || []) await window.PanthoriumSocial.renderCard(v, post, posts);
  }
  function messageVisible(v, node) {
    if (!current(v) || document.visibilityState !== "visible" || !document.hasFocus() ||
        !v.messageLog?.contains(node) || !v.root.contains(v.messageLog)) return false;
    const win = v.root.closest(".window");
    const z = Number(getComputedStyle(win).zIndex) || 0;
    for (const other of document.querySelectorAll(".window"))
      if (other !== win && other.getClientRects().length && (Number(getComputedStyle(other).zIndex) || 0) > z) return false;
    const rect = node.getBoundingClientRect();
    let left = Math.max(0, rect.left), top = Math.max(0, rect.top),
      right = Math.min(innerWidth, rect.right), bottom = Math.min(innerHeight, rect.bottom);
    for (let parent = node.parentElement; parent; parent = parent.parentElement) {
      const style = getComputedStyle(parent), bounds = parent.getBoundingClientRect();
      if (style.display === "none" || style.visibility !== "visible" || Number(style.opacity) === 0) return false;
      if (/(auto|scroll|hidden|clip)/.test(style.overflowX)) { left = Math.max(left, bounds.left); right = Math.min(right, bounds.right); }
      if (/(auto|scroll|hidden|clip)/.test(style.overflowY)) { top = Math.max(top, bounds.top); bottom = Math.min(bottom, bounds.bottom); }
    }
    if (rect.height <= 0 || rect.width <= 0 || bottom - top < Math.min(24, rect.height) || right - left < Math.min(80, rect.width)) return false;
    const hit = document.elementFromPoint((left + right) / 2, (top + bottom) / 2);
    return !!hit && node.contains(hit);
  }
  function scheduleRead(v) {
    clearTimeout(v.readTimer);
    v.readTimer = setTimeout(() => acknowledgeVisible(v), 150);
  }
  async function acknowledgeVisible(v) {
    if (v.readBusy || !current(v) || !v.messageLog?.isConnected || !v.detail) return;
    const log = v.messageLog, threadId = v.detail;
    const ids = [...log.querySelectorAll('[data-incoming="true"]')]
      .filter(node => !v.readSeen?.has(node.dataset.messageId) && messageVisible(v, node))
      .map(node => node.dataset.messageId).slice(0, 100);
    if (!ids.length) return;
    v.readBusy = true;
    try {
      await api(v, "/api/social/records/" + encodeURIComponent(threadId) + "/read", {
        method: "POST", body: JSON.stringify({ messageIds: ids }),
      });
      if (current(v) && v.messageLog === log) {
        v.readSeen ||= new Set();
        for (const id of ids) v.readSeen.add(id);
        refreshNotifications();
      }
    } catch (_) {
      // Retry visible messages on the next poll; never claim an unconfirmed read.
    } finally { v.readBusy = false; }
  }
  async function renderMessages(v, items, log) {
    if (!current(v) || !log.isConnected) return;
    const version = v.messageRender = (v.messageRender || 0) + 1;
    v.readObserver?.disconnect();
    const previous = v.groupState && v.messageLog === log ? new Map([...log.children].map(node => [node.dataset.messageId, node])) : null;
    if (!previous) log.replaceChildren();
    const rendered = [];
    const revoke = node => {
      for (const media of node.querySelectorAll('[src^="blob:"]')) { URL.revokeObjectURL(media.src); v.urls.delete(media.src); }
    };
    for (const msg of items) {
      if (!current(v) || !log.isConnected || v.messageRender !== version) return;
      const signature = JSON.stringify([msg.text, msg.files, msg.author, msg.createdAt]);
      const old = previous?.get(msg.id);
      const reuse = old?.dataset.messageSignature === signature;
      const c = reuse ? old : el("article", null, { class: "social-message", "data-message-id": msg.id });
      c.dataset.messageSignature = signature;
      rendered.push(c);
      const chat = ["message", "group-message"].includes(msg.kind);
      if (chat && msg.ownerId !== v.uid && !msg.readAt) c.dataset.incoming = "true";
      else delete c.dataset.incoming;
      if (!reuse) c.append(
        el(
          "small",
          (msg.ownerId === v.uid ? "คุณ" : msg.author?.name || "สมาชิก") +
            " • " +
            new Date(msg.createdAt).toLocaleString("th-TH"),
        ),
        el("p", msg.text),
      );
      if (chat && msg.ownerId === v.uid) {
        const label = msg.readAt ? msg.kind === "group-message" ? "อ่านแล้ว " + msg.readCount + " คน" : "อ่านแล้ว" : "ส่งแล้ว";
        const receipt = c.querySelector(".social-message-receipt") || el("span", null, {
          class: "social-message-receipt", "data-delivery": msg.readAt ? "read" : "sent",
          "aria-label": label, title: label,
        });
        receipt.textContent = msg.readAt ? "✓✓" : "✓";
        receipt.dataset.delivery = msg.readAt ? "read" : "sent";
        receipt.setAttribute("aria-label", label); receipt.title = label;
        if (!receipt.isConnected) c.append(receipt);
        if (msg.kind === "group-message") {
          const count = c.querySelector("[data-group-read-count]") || el("small", null, { "data-group-read-count": "" });
          count.textContent = msg.readCount ? label : "";
          if (!count.isConnected) c.append(count);
        }
      }
      if (reuse) continue;
      await media(v, msg, c);
      if (!current(v) || !log.isConnected || v.messageRender !== version) return;
      if (msg.ownerId === v.uid && chat)
        c.append(
          button(v, "ลบข้อความ", async () => {
            await write(v, "delete", { recordId: msg.id });
            v.groupItems?.delete(msg.id);
            c.remove();
          }),
        );
      if (old) { revoke(old); old.replaceWith(c); }
      else log.append(c);
    }
    if (previous) {
      const keep = new Set(rendered);
      for (const node of [...log.children]) if (!keep.has(node)) { revoke(node); node.remove(); }
      rendered.forEach((node, index) => { if (log.children[index] !== node) log.insertBefore(node, log.children[index] || null); });
    }
    if (current(v) && v.messageLog === log && log.isConnected) {
      if (window.IntersectionObserver) {
        v.readObserver = new IntersectionObserver(() => scheduleRead(v), { threshold: [0, 0.5, 1] });
        log.querySelectorAll('[data-incoming="true"]').forEach(node => v.readObserver.observe(node));
      }
      scheduleRead(v);
    }
  }
  async function connectSettings(v) {
    clear(v);
    const data = await api(v, "/api/social/profile"),
      old = data.connect;
    const card = section(v, "Connect • สมัครใจเปิดใช้สำหรับผู้ใหญ่"),
      f = el("form");
    card.append(f);
    const name = input(f, "ชื่อใน Connect", "text", old?.name || ""),
      bio = input(f, "แนะนำตัว", "textarea", old?.bio || ""),
      gender = select(
        f,
        "เพศของฉัน",
        [
          ["male", "ชาย"],
          ["female", "หญิง"],
          ["nonbinary", "นอนไบนารี"],
          ["self-described", "ระบุด้วยตนเองในคำแนะนำตัว"],
        ],
        old?.gender,
      ),
      pref = select(
        f,
        "สนใจทำความรู้จัก",
        [
          ["all", "ทุกเพศ"],
          ["male", "ชาย"],
          ["female", "หญิง"],
          ["nonbinary", "นอนไบนารี"],
          ["self-described", "ระบุด้วยตนเอง"],
        ],
        old?.preferences?.[0],
      ),
      adult = input(
        f,
        "ฉันอายุ 18 ปีขึ้นไป และยินยอมแสดงโปรไฟล์นี้ต่อผู้เปิดใช้ Connect",
        "checkbox",
      );
    const sync = input(f, "ใช้ชื่อ รูป และคำแนะนำจากโปรไฟล์ของฉันใน Connect", "checkbox");
    sync.checked = old ? old.syncProfile === true : true;
    let fileFields;
    const syncFields = () => {
      if (sync.checked) { name.value = data.profile?.name || ""; bio.value = data.profile?.bio || ""; }
      name.disabled = bio.disabled = sync.checked;
      if (fileFields) fileFields.hidden = sync.checked;
    };
    sync.onchange = syncFields; syncFields();
    f.append(el("p", "เพศและความสนใจในการค้นหาเป็นการตั้งค่าส่วนตัว ใช้จับคู่ชาย–ชาย ชาย–หญิง หญิง–หญิง หรือความสนใจที่เลือก ข้อมูลจากโปรไฟล์จะแชร์ใน Connect เมื่อคุณเปิดใช้และยินยอมเท่านั้น"));
    const getFiles = await attachments(v, f, (old?.files || []).map(file => file.id));
    fileFields = f.lastElementChild; syncFields();
    bindForm(
      v,
      f,
      "connect",
      () => ({
        enabled: true,
        adultConfirmed: adult.checked,
        syncProfile: sync.checked,
        name: name.value,
        bio: bio.value,
        gender: gender.value,
        preferences: [pref.value],
        fileIds: getFiles(),
      }),
      () => feed(v),
    );
    card.append(
      button(v, "ปิด Connect และหยุดการค้นพบ/สนทนา", async () => {
        await write(v, "connect", { enabled: false });
        await feed(v);
      }),
    );
  }
  async function collections(v, kind, targetId) {
    clear(v);
    const data = await api(v, "/api/social/collections/" + kind),
      card = section(
        v,
        kind === "group"
          ? "กลุ่มชุมชน"
          : kind === "block"
            ? "บัญชีที่บล็อก"
            : "เพลย์ลิสต์ส่วนตัว",
      );
    if (kind !== "block") {
      const f = el("form"),
        title = input(f, "ชื่อ");
      card.append(f);
      title.maxLength = 120; title.required = true;
      const privacy = kind === "group" ? select(f, "ประเภทกลุ่ม", [["open", "แบบเปิด — เข้าร่วมได้ทันที"], ["closed", "แบบปิด — ผู้สร้างอนุมัติคำขอ"]], "open") : null;
      const description = kind === "group" ? input(f, "คำอธิบายกลุ่ม", "textarea") : null;
      if (description) description.maxLength = 2000;
      bindForm(
        v,
        f,
        kind === "group" ? "group-create" : "playlist-create",
        () => ({ title: title.value, ...(privacy ? { privacy: privacy.value, text: description.value } : {}) }),
        out => kind === "group" ? detail(v, out.record.id) : collections(v, kind, targetId),
      );
    }
    for (const r of data.items) {
      const c = el("article", null, { class: "social-card" });
      c.append(el("h4", r.title || r.targetId));
      if (kind === "group") c.append(el("p", groupSummary(r)), el("small", r.membership === "member" ? "เป็นสมาชิกแล้ว" : r.membership === "pending" ? "รออนุมัติคำขอ" : ""));
      if (kind === "block")
        c.append(
          button(v, "เลิกบล็อก", async () => {
            await write(v, "block", { userId: r.targetId, enabled: false });
            await collections(v, kind);
          }),
        );
      else if (targetId)
        c.append(
          button(v, "เพิ่มวิดีโอนี้", async () => {
            await write(v, "playlist-add", { recordId: r.id, targetId });
            status(v, "เพิ่มลงเพลย์ลิสต์แล้ว");
          }),
        );
      else c.append(button(v, "เปิด", () => detail(v, r.id)));
      card.append(c);
    }
  }
  async function edit(v, r) {
    clear(v);
    const c = section(v, "แก้ไขรายการ"),
      f = el("form");
    c.append(f);
    const title = input(f, "ชื่อเรื่อง", "text", r.title),
      text = input(f, "เนื้อหา", "textarea", r.text),
      audience = select(
        f,
        "ผู้ชม",
        [
          ["public", "ผู้ใช้ที่เข้าสู่ระบบ"],
          ["followers", "ผู้ติดตาม"],
          ["private", "เฉพาะฉัน"],
        ],
        r.audience,
      );
    if (r.audience === "group") audience.disabled = true;
    bindForm(
      v,
      f,
      "edit",
      () => ({
        recordId: r.id,
        title: title.value,
        text: text.value,
        ...(r.audience === "group" ? {} : { audience: audience.value }),
      }),
      () => feed(v),
    );
  }
  async function orders(v, selectedId) {
    clear(v);
    const data = await api(v, "/api/social/inbox"),
      sectionNode = section(v, "รายการซื้อขาย");
    sectionNode.append(
      el(
        "p",
        "ระบบรับคำสั่งซื้อและติดตามสถานะ ยังไม่เรียกเก็บเงินหรือจ่ายเงินให้ผู้ขายอัตโนมัติ",
      ),
    );
    for (const r of data.orders) {
      const c = el("article", null, { class: "social-card" });
      c.append(
        el("h3", r.title),
        el(
          "p",
          `${r.quantity} ชิ้น • ${r.totalSatang / 100} บาท • ${r.status}`,
        ),
      );
      for (const next of r.status === "requested"
        ? ["accepted", "cancelled"]
        : r.status === "accepted"
          ? ["fulfilled", "cancelled"]
          : []) {
        if (next !== "cancelled" && r.sellerId !== v.uid) continue;
        c.append(
          button(
            v,
            {
              accepted: "รับคำสั่งซื้อ",
              cancelled: "ยกเลิก",
              fulfilled: "ส่งมอบแล้ว",
            }[next],
            async () => {
              await write(v, "order-status", { recordId: r.id, status: next });
              await orders(v);
            },
          ),
        );
      }
      sectionNode.append(c);
      if (r.id === selectedId) { c.dataset.selectedOrder = "true"; c.style.borderColor = "#ff9f43"; c.scrollIntoView?.({ block: "nearest" }); }
    }
  }
  async function startRTC(v, r) {
    v.rtc.replaceChildren();
    v.rtc.hidden = false;
    v.sessionId = r.id;
    const screen = el("div", null, { class: "social-video-grid" });
    v.rtc.append(
      button(v, "วางสาย / ออกจากไลฟ์", async () => {
        await window.PanthoriumSocialRTC.stop();
        v.sessionId = null;
        v.rtc.hidden = true;
      }),
      button(v, "เปิด/ปิดไมค์", () => window.PanthoriumSocialRTC.toggleMic()),
      button(v, "เปิด/ปิดกล้อง", () =>
        window.PanthoriumSocialRTC.toggleCamera(),
      ),
      screen,
    );
    await window.PanthoriumSocialRTC.start({
      id: r.id,
      kind: r.kind,
      owner: r.ownerId,
      uid: v.uid,
      video: r.video !== false,
      read: (path) => api(v, path),
      write: (action, input) => write(v, action, input),
      render: screen,
      status: (text) => status(v, text),
    });
  }
  async function call(v, r, video) {
    const out = await write(v, "call", { recordId: r.id, video });
    v.call = out.record;
    status(v, "ส่งคำเชิญโทรแล้ว รออีกฝ่ายรับสาย");
  }
  async function poll(v) {
    if (!current(v)) return;
    let groupDetailId;
    try {
      if (["talk", "connect"].includes(v.module)) {
        const data = await api(v, "/api/social/inbox");
        if (!current(v)) return;
        v.incoming.replaceChildren();
        for (const c of data.calls) {
          if ((c.context === "connect") !== (v.module === "connect")) continue;
          if (c.status === "ringing" && c.ownerId !== v.uid) {
            const box = el("div", null, { class: "social-card" });
            box.append(
              el(
                "p",
                (c.video ? "วิดีโอคอล" : "สายโทรเข้า") + " จาก " + (c.author?.name || "สมาชิก"),
              ),
              button(v, "รับสาย", async () => {
                const result = await write(v, "call-answer", {
                  recordId: c.id,
                  accept: true,
                });
                await startRTC(v, result.record);
              }),
              button(v, "ปฏิเสธ", () =>
                write(v, "call-answer", { recordId: c.id, accept: false }),
              ),
            );
            v.incoming.append(box);
          } else if (
            c.status === "accepted" &&
            v.call?.id === c.id &&
            v.sessionId !== c.id
          )
            await startRTC(v, c);
        }
      }
      if (!v.root.hidden && v.detail && (v.messageLog?.isConnected || v.groupState)) {
        const detailId = v.detail, messageLog = v.messageLog;
        if (v.groupState) groupDetailId = detailId;
        const latest = await api(
          v,
          "/api/social/records/" + encodeURIComponent(detailId),
        );
        if (!current(v) || v.detail !== detailId || v.messageLog !== messageLog) return;
        if (v.groupState) {
          if (latest.record.membership !== v.groupState.membership) { await detail(v, detailId); return; }
          v.groupState.summary.textContent = groupSummary(latest.record);
          groupRequests(v, latest.requests || []);
          if (latest.record.membership === "member") await groupMessages(v, latest);
          return;
        }
        const fingerprint = JSON.stringify(
          latest.items.map((x) => [x.id, x.deleted, x.readAt, x.author?.name]),
        );
        if (fingerprint !== v.lastMessages) {
          v.lastMessages = fingerprint;
          await renderMessages(v, latest.items, v.messageLog);
        }
        scheduleRead(v);
      }
    } catch (e) {
      if (v.groupState && v.detail === groupDetailId && e.message === "social_not_found") clear(v);
      status(v, friendly(e));
    } finally {
      if (current(v)) v.timer = setTimeout(() => poll(v), 4000);
    }
  }
  async function feed(v, before, mode) {
    if (v.module === "community") return collections(v, "group");
    if (v.module === "profile") return profile(v);
    if (v.module === "friends") return people(v);
    if (mode) v.feedMode = mode;
    if (!before) {
      clear(v);
      v.detail = null;
      v.messageLog = null;
    }
    const data = await api(
      v,
      "/api/social/feed/" +
        v.module +
        "?query=" +
        encodeURIComponent(v.search.value) +
        (v.module === "connect" && v.feedMode === "chats" ? "&mode=chats" : "") +
        (before ? "&before=" + encodeURIComponent(before) : ""),
    );
    if (!current(v)) return;
    if (data.optInRequired) {
      section(v, "Connect ยังไม่ได้เปิดใช้").append(
        button(v, "ตั้งค่า Connect 18+", () => connectSettings(v)),
      );
      return;
    }
    if (!data.items.length && !before)
      section(v, "ยังไม่มีรายการ").append(
        el("p", "เริ่มสร้างรายการของคุณ หรือค้นหาผู้ใช้เพื่อเชื่อมต่อ"),
      );
    for (const r of data.items) await card(v, r, v.content);
    if (data.nextCursor)
      v.content.append(
        button(v, "โหลดรายการก่อนหน้า", async () => {
          await feed(v, data.nextCursor);
        }),
      );
  }
  async function support(v) {
    clear(v);
    status(v, "กำลังเปิดแชทกับแอดมิน…");
    const result = await api(v, "/api/social/support", { method: "POST" });
    if (result.inbox) await feed(v);
    else await detail(v, result.record.id);
    status(v, "");
  }
  function disposeWorkspace() {
    for (const v of views.values()) {
      v.controller.abort(); clearTimeout(v.timer); clearTimeout(v.readTimer); v.readObserver?.disconnect();
      for (const url of v.urls) URL.revokeObjectURL(url);
      if (v.sessionId) window.PanthoriumSocialRTC?.stop();
    }
    views.clear(); workspace?.controller.abort(); workspace = null;
  }
  function ensureWorkspace() {
    if (workspace && current(workspace)) return workspace;
    if (workspace) disposeWorkspace();
    const markup = `<div class="social-shell"><style>
      .social-shell{height:100%;min-height:0;display:flex;flex-direction:column;color:var(--text,#edf2f7);background:#0b131d;overflow:hidden}
      .social-shell *{box-sizing:border-box}.social-shell [hidden]{display:none!important}
      .social-shell button,.social-shell input,.social-shell select,.social-shell textarea{font:inherit;color:inherit;background:#152332;border:1px solid #33495b;border-radius:10px;padding:9px;max-width:100%}
      .social-shell button{cursor:pointer;min-height:40px;margin:3px}.social-shell button:hover{border-color:#ff9d4d}.social-shell button:focus-visible,.social-shell summary:focus-visible{outline:2px solid #ffb26e;outline-offset:2px}.social-shell button:disabled{opacity:.5}
      .social-tabs{display:flex;flex:0 0 auto;flex-wrap:nowrap;gap:5px;overflow-x:auto;overflow-y:hidden;padding:8px 12px 6px;border-bottom:1px solid #263b4b;background:#0e1d2a;scrollbar-width:thin;scrollbar-color:#6b8ba1 #101b26}
      .social-tabs button{white-space:nowrap;flex:0 0 auto;min-height:42px;margin:0;padding:9px 14px;border:1px solid transparent;background:transparent;font-weight:600}
      .social-tabs button[aria-selected=true]{background:#263343;border-color:#ee984e;color:#ffbf88}.social-tabs button:last-child{color:#bed0df}
      .social-pages{flex:1;min-height:0;overflow:hidden}.social-app{height:100%;overflow:auto;padding:12px 18px 24px;scrollbar-width:thin;scrollbar-color:#496779 #101923}
      .social-toolbar{display:flex;gap:6px;align-items:center;flex-wrap:wrap;margin:0 0 8px}.social-toolbar form{display:flex;gap:5px;align-items:center}.social-toolbar form label{margin:0}.social-toolbar input{min-width:100px;width:230px!important;margin:0!important}.social-toolbar form button{margin:0}.social-toolbar .social-tools{margin-left:auto}
      .social-tools{position:relative}.social-tools summary,.social-activity summary{cursor:pointer;padding:9px 12px;border-radius:9px;background:#142433;color:#c2d4e3;min-height:40px}.social-tools>div{padding:10px;max-width:360px}
      .social-app label{display:block;margin:10px 0}.social-app label input:not([type=checkbox]),.social-app textarea,.social-app select{display:block;width:100%;margin-top:5px}.social-app textarea{min-height:90px;resize:vertical}.social-app option{background:#152332;color:#fff}
      .social-card{border:1px solid #2b4052;border-radius:14px;padding:16px;margin:12px 0;background:#101c28;min-width:0}.social-card h3,.social-card h4{margin:0 0 10px;overflow-wrap:anywhere}.social-card p,.social-message p{white-space:pre-wrap;overflow-wrap:anywhere}.social-card strong{overflow-wrap:anywhere}
      .social-record-tools{margin-top:12px}.social-record-tools summary{cursor:pointer;color:#acbfce;padding:6px 0}
      .social-comments{border-top:1px solid #304252;margin-top:16px;padding-top:12px}.social-message{padding:12px;border-bottom:1px solid #304252}.social-app small{color:#acbfce;overflow-wrap:anywhere}.social-app [role=status]{color:#ffb26e}.social-app [role=status]:empty{display:none}
      .social-media{margin:10px 0}.social-media img,.social-media video{display:block;max-width:100%;max-height:560px;border-radius:10px}.social-media audio{max-width:100%}.social-media pre{white-space:pre-wrap;max-height:420px;overflow:auto}
      .social-video-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:8px}.social-video-grid video{width:100%;max-height:400px;background:#000}
      .social-message-receipt{display:inline-block;margin:4px 8px;color:#9bb1c9;font-size:18px;font-weight:600}.social-message-receipt[data-delivery=read]{letter-spacing:-6px;padding-right:6px;color:#66d0ff}
      .social-activity{border-bottom:1px solid #263b4b;margin-bottom:10px}.social-activity summary{background:transparent;padding:7px 3px;min-height:32px;font-size:13px}.social-activity article{padding:10px;border-bottom:1px solid #263b4b}.social-activity article[data-unread=true]{border-left:3px solid #ff9f43}.social-activity p{margin:4px 0}.social-activity [data-activity-items]{max-height:330px;overflow:auto}
      @media(max-width:540px){.social-app{padding:10px}.social-tabs{padding:6px 8px}.social-tabs button{padding:8px 11px}.social-card{padding:12px}.social-toolbar{align-items:stretch}.social-toolbar form{flex:1 1 100%;min-width:0}.social-toolbar form label{flex:1;min-width:0}.social-toolbar input{min-width:0;width:100%!important}.social-tools{margin-left:0!important}}
    </style><nav class="social-tabs" role="tablist" aria-label="Social Media"></nav><div class="social-pages"></div></div>`;
    if (typeof window.createWindow !== "function") throw Error("window_system_unavailable");
    window.createWindow(WINDOW_ID, "Social Media", markup, { width: 1040, height: 740, onClose: disposeWorkspace });
    const root = document.querySelector('.window[data-id="' + WINDOW_ID + '"] .social-shell');
    if (!root) throw Error("window_system_unavailable");
    const shell = workspace = { uid: uid(), root, controller: new AbortController() };
    const nav = root.querySelector(".social-tabs");
    for (const [id, label, thai] of specs) {
      const tab = button(shell, label, () => open(id));
      tab.dataset.socialTab = id; tab.id = "social-tab-" + id;
      tab.setAttribute("role", "tab"); tab.setAttribute("aria-controls", "social-page-" + id); tab.setAttribute("aria-selected", "false"); tab.title = thai;
      tab.append(moduleBadge(id)); nav.append(tab);
    }
    const refresh = button(shell, "Refresh", () => refreshView(views.get(workspace?.active)));
    refresh.title = "รีเฟรชเมนูที่เปิดอยู่"; nav.append(refresh);
    nav.addEventListener("keydown", event => {
      if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key) || event.target.getAttribute("role") !== "tab") return;
      event.preventDefault(); const tabs = [...nav.querySelectorAll('[role="tab"]')], index = tabs.indexOf(event.target);
      const next = event.key === "Home" ? 0 : event.key === "End" ? tabs.length - 1 : (index + (event.key === "ArrowRight" ? 1 : -1) + tabs.length) % tabs.length;
      tabs[next].click(); tabs[next].focus();
    });
    notificationBadges();
    return shell;
  }
  function activate(module) {
    const shell = ensureWorkspace(); shell.active = module;
    shell.root.closest(".window").dataset.socialActive = module;
    for (const [id, v] of views) {
      v.root.hidden = id !== module;
      if (id !== module) v.root.querySelectorAll("video,audio").forEach(media => { if (!media.srcObject) media.pause(); });
    }
    for (const tab of shell.root.querySelectorAll("[data-social-tab]")) {
      const selected = tab.dataset.socialTab === module;
      tab.setAttribute("aria-selected", String(selected)); tab.tabIndex = selected ? 0 : -1;
    }
    shell.root.querySelector('[data-social-tab="' + module + '"]')?.scrollIntoView?.({ block: "nearest", inline: "nearest" });
    window.PanthoriumWindowManager?.restore?.(WINDOW_ID); window.focusWindow?.(WINDOW_ID);
  }
  function moduleTools(v) {
    const toolbar = v.root.querySelector("[data-social-toolbar]");
    v.search = el("input"); v.search.value = "";
    if (["watch", "short", "live", "market", "talk", "connect"].includes(v.module)) {
      const form = el("form"), q = input(form, "ค้นหารายการ");
      q.placeholder = "ค้นหาใน " + specs.find(s => s[0] === v.module)[1];
      q.parentElement.firstChild.textContent = ""; q.setAttribute("aria-label", "ค้นหารายการ");
      v.search = q; form.append(el("button", "ค้นหา", { type: "submit" }));
      form.onsubmit = event => { event.preventDefault(); feed(v).catch(error => status(v, friendly(error))); }; toolbar.append(form);
    }
    if (["watch", "short", "market"].includes(v.module)) toolbar.append(button(v, v.module === "market" ? "ลงสินค้า" : v.module === "short" ? "โพสต์วิดีโอ" : "สร้างโพสต์", () => compose(v)));
    if (["watch", "short", "live", "market", "talk"].includes(v.module)) toolbar.append(button(v, "รายการทั้งหมด", () => feed(v)));
    if (v.module === "short") toolbar.append(button(v, "เพลย์ลิสต์", () => collections(v, "playlist")));
    if (v.module === "community") toolbar.append(button(v, "กลุ่ม", () => collections(v, "group")));
    if (v.module === "talk") toolbar.append(button(v, "ค้นหาเพื่อน", () => open("friends")));
    if (v.module === "market") toolbar.append(button(v, "รายการซื้อขาย", () => orders(v)));
    if (v.module === "connect") {
      toolbar.append(button(v, "ตั้งค่า Connect", () => connectSettings(v)), button(v, "ค้นหาคู่", () => feed(v, null, "discover")), button(v, "บทสนทนา Connect", () => feed(v, null, "chats")));
    }
    if (["profile", "friends"].includes(v.module)) toolbar.append(button(v, "บัญชีที่บล็อก", () => collections(v, "block")));
    if (v.module === "friends") toolbar.append(button(v, "ค้นหาเพื่อน", () => people(v)));
    if (v.module === "live") toolbar.append(button(v, "เริ่มไลฟ์", async () => {
      clear(v); const form = el("form"), title = input(form, "ชื่อไลฟ์");
      section(v, "เริ่มถ่ายทอดสด • ผู้ชมพร้อมกันสูงสุด 8 คน").append(form);
      bindForm(v, form, "live-start", () => ({ title: title.value }), async out => { await startRTC(v, out.record); await detail(v, out.record.id); });
    }));
    if (["watch", "short", "market", "profile"].includes(v.module)) {
      const tools = el("details", null, { class: "social-tools" }); tools.append(el("summary", "เครื่องมือที่เชื่อมงาน"));
      const body = el("div"); tools.append(body); toolbar.append(tools);
      const apps = select(body, "เปิดเครื่องมือ Panthorium", [["", "เลือกเครื่องมือ"], ...(window.PanthoriumWindowCatalog?.apps || []).filter(a => !a.virtual && !a.native && !a.id.startsWith("social-") && window.PanthoriumWindowCatalog.allowed(a, os().state.user)).map(a => [a.key, a.label])]);
      apps.onchange = () => { if (apps.value) window.PanthoriumVoiceCommands?.windowAction("open_" + apps.value); apps.value = ""; };
    }
  }
  async function refreshView(v) {
    if (!v || !current(v)) return;
    if (v.detail) await detail(v, v.detail);
    else if (v.module === "profile") await profile(v);
    else if (v.module === "friends") await people(v);
    else if (v.module === "community") await collections(v, "group");
    else await feed(v);
    await refreshNotifications();
  }
  async function open(module = "watch", options = {}) {
    if (!allowed()) throw Error("account_required");
    if (!specs.some(s => s[0] === module)) throw Error("social_invalid_module");
    const shell = ensureWorkspace();
    let v = views.get(module), created = false;
    if (!v || !current(v)) {
      created = true;
      const root = el("div", null, { class: "social-app", "data-social": module, id: "social-page-" + module, role: "tabpanel", "aria-labelledby": "social-tab-" + module });
      root.innerHTML = '<div class="social-toolbar" data-social-toolbar></div><details class="social-activity"><summary>กิจกรรมในเมนูนี้ </summary><div data-activity-items></div></details><p role="status" aria-live="polite"></p><div data-social-incoming></div><section data-social-rtc hidden></section><div data-social-content></div>';
      shell.root.querySelector(".social-pages").append(root);
      v = { uid: uid(), root, module, controller: new AbortController(), urls: new Set(), sourceFileIds: [], status: root.querySelector("[role=status]"), content: root.querySelector("[data-social-content]"), incoming: root.querySelector("[data-social-incoming]"), rtc: root.querySelector("[data-social-rtc]") };
      views.set(module, v); moduleTools(v);
      root.querySelector(".social-activity summary").append(moduleBadge(module));
      root.querySelector(".social-activity").addEventListener("toggle", () => { if (root.querySelector(".social-activity").open) loadActivity(v); });
      root.addEventListener("scroll", () => scheduleRead(v), { capture: true, signal: v.controller.signal });
      root.addEventListener("pointerup", () => scheduleRead(v), { signal: v.controller.signal });
      window.addEventListener("focus", () => scheduleRead(v), { signal: v.controller.signal });
      document.addEventListener("visibilitychange", () => scheduleRead(v), { signal: v.controller.signal });
    }
    activate(module);
    try {
      if (options.support) await support(v);
      else if (options.orders) await orders(v, options.recordId);
      else if (options.personId) await people(v);
      else if (options.recordId) await detail(v, options.recordId);
      else if (options.sourceFileIds) {
        v.sourceFileIds = options.sourceFileIds;
        if (module === "community") { await collections(v, "group"); status(v, "เลือกกลุ่มที่เป็นสมาชิกเพื่อแนบไฟล์ในแชต"); }
        else await compose(v);
      }
      else if (created) await refreshView(v);
    } catch (error) { status(v, friendly(error)); }
    if (created && ["talk", "live", "community", "connect"].includes(module)) poll(v);
    if (!created && v.module === "friends") await v.refreshFriends?.();
    notificationBadges(); loadActivity(v); scheduleRead(v);
    return v.root;
  }
  let notificationState;
  function notificationStyles() {
    if (document.getElementById("social-notification-style")) return;
    document.head.append(el("style", '.social-notification-badge{display:inline-block;min-width:19px;padding:1px 5px;margin-left:6px;border-radius:20px;background:#ff9f43;color:#101820;font:700 11px/18px system-ui;text-align:center}.social-notification-badge[hidden]{display:none!important}', { id: "social-notification-style" }));
  }
  const moduleBadge = module => el("span", "", { class: "social-notification-badge", "data-social-module-count": module, hidden: "" });
  const notificationBadge = () => el("span", "", { class: "social-notification-badge", "data-social-notification-count": "", hidden: "" });
  function notificationBadges() {
    const data = notificationState?.data || {};
    for (const node of document.querySelectorAll("[data-social-notification-count],[data-social-module-count]")) {
      const count = node.hasAttribute("data-social-module-count") ? data.counts?.[node.dataset.socialModuleCount] || 0 : data.unreadCount || 0;
      node.textContent = count > 99 ? "99+" : String(count); node.hidden = count === 0;
      node.setAttribute("aria-label", count + " การแจ้งเตือนยังไม่อ่าน");
    }
  }
  async function readNotifications(v, ids) {
    if (!ids.length) return;
    await api(v, "/api/social/notifications/read", { method: "POST", body: JSON.stringify({ ids }) });
    await refreshNotifications(); await loadActivity(v, v.activityCursor);
  }
  async function loadActivity(v, before = null) {
    if (!v || !current(v)) return;
    if (v.activityBusy) return v.activityBusy;
    v.activityBusy = (async () => {
      const panel = v.root.querySelector("[data-activity-items]");
      try {
        const data = await api(v, "/api/social/notifications?module=" + v.module + (before ? "&before=" + encodeURIComponent(before) : ""));
        if (!current(v) || !panel?.isConnected) return;
        const signature = JSON.stringify([data.items, data.nextCursor, before]);
        if (v.activitySignature === signature) return;
        v.activitySignature = signature; v.activityCursor = before;
        const focused = panel.contains(document.activeElement) ? document.activeElement.dataset.notificationFocus : null;
        panel.replaceChildren();
        if (!data.items.length) panel.append(el("p", "ยังไม่มีกิจกรรมใหม่ในเมนูนี้"));
        const unread = data.items.filter(item => !item.readAt).map(item => item.id);
        if (unread.length) panel.append(button(v, "อ่านทั้งหมดในหน้านี้", () => readNotifications(v, unread)));
        for (const item of data.items) {
          const row = el("article", null, { "data-notification-id": item.id, "data-unread": String(!item.readAt) });
          row.append(el("p", item.name + " • " + item.text), el("small", new Date(item.createdAt).toLocaleString("th-TH")));
          if (item.reason) row.append(el("p", item.reason));
          if (item.target) {
            const go = button(v, "เปิดรายการ", async () => {
              if (!item.readAt) await readNotifications(v, [item.id]);
              v.root.querySelector(".social-activity").open = false;
              await open(item.target.module, item.target);
              if (item.target.module === "friends") await people(views.get("friends"));
            }); go.dataset.notificationFocus = item.id; row.append(go);
          }
          if (!item.readAt) { const mark = button(v, "อ่านแล้ว", () => readNotifications(v, [item.id])); mark.dataset.notificationFocus = "read:" + item.id; row.append(mark); }
          panel.append(row);
        }
        if (before) panel.append(button(v, "รายการล่าสุด", () => loadActivity(v)));
        if (data.nextCursor) panel.append(button(v, "รายการก่อนหน้า", () => loadActivity(v, data.nextCursor)));
        if (focused) [...panel.querySelectorAll("[data-notification-focus]")].find(node => node.dataset.notificationFocus === focused)?.focus({ preventScroll: true });
      } catch (error) {
        if (current(v) && panel?.isConnected) panel.replaceChildren(el("p", "โหลดกิจกรรมไม่สำเร็จ"), button(v, "ลองอีกครั้ง", () => loadActivity(v, before)));
      } finally { v.activityBusy = null; }
    })();
    return v.activityBusy;
  }
  async function refreshNotifications() {
    const n = notificationState;
    if (!n || !current(n)) return;
    if (n.polling) return n.polling;
    clearTimeout(n.timer);
    n.polling = (async () => {
      try {
        const data = await api(n, "/api/social/notifications");
        if (!current(n) || n !== notificationState) return;
        const changed = JSON.stringify(n.data) !== JSON.stringify(data);
        n.data = data; n.error = ""; notificationBadges();
        const v = views.get(workspace?.active);
        if (changed && v) { await loadActivity(v, v.activityCursor); if (v.module === "friends") await v.refreshFriends?.(); }
      } catch (error) { n.error = "notification_unavailable"; }
      finally {
        n.polling = null;
        if (current(n) && n === notificationState) n.timer = setTimeout(refreshNotifications, n.error || document.visibilityState === "hidden" ? 30000 : 5000);
      }
    })();
    return n.polling;
  }
  async function showNotifications(v) {
    if (!v || !current(v)) { await open(workspace?.active || "watch"); v = views.get(workspace.active); }
    v.root.querySelector(".social-activity").open = true; await loadActivity(v);
  }
  function syncNotifications() {
    if (notificationState && !current(notificationState)) {
      notificationState.controller.abort(); clearTimeout(notificationState.timer); notificationState = null; notificationBadges();
    }
    if (!allowed() || notificationState) return;
    notificationStyles();
    const n = notificationState = { uid: uid(), root: document.body, controller: new AbortController(), data: { items: [], unreadCount: 0, counts: {} } };
    document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") refreshNotifications(); }, { signal: n.controller.signal });
    window.addEventListener("online", refreshNotifications, { signal: n.controller.signal });
    refreshNotifications();
  }

  function menu() {
    syncNotifications();
    const target = document.getElementById("sm-apps");
    if (!target) return;
    if (!allowed()) {
      target.querySelector('[data-start-group="social"]')?.remove();
      return;
    }
    const g = window.PanthoriumStartMenuUI?.group(
      "social",
      "Social Media",
      target,
    );
    if (!g) return;
    g.querySelector(".social-notification-menu")?.remove();
    if (!g.querySelector(".sm-group-label [data-social-notification-count]")) g.querySelector(".sm-group-label")?.append(notificationBadge());
    for (const [id, name, thai, icon] of specs) {
      if (g.querySelector('[data-app-id="social-' + id + '"]')) continue;
      const b = el("button", icon + " " + name + " · " + thai, {
        type: "button",
        class: "sm-app",
        "data-app-id": "social-" + id,
        "data-search-text": "social โซเชียล " + name + " " + thai,
      });
      b.append(el("span", "", { class: "social-notification-badge", "data-social-module-count": id, hidden: "" }));
      b.onclick = () => {
        open(id).catch((e) => {
          if (typeof toast === "function") toast(friendly(e));
        });
        document.getElementById("start-menu")?.classList.remove("open");
      };
      window.PanthoriumStartMenuUI.groupItems(g).append(b);
    }
    notificationBadges();
  }
  function cleanup() {
    for (const v of views.values()) {
      if (!current(v)) {
        v.controller.abort();
        clearTimeout(v.timer);
        clearTimeout(v.readTimer);
        v.readObserver?.disconnect();
        for (const url of v.urls) URL.revokeObjectURL(url);
        v.root.replaceChildren();
        views.delete(v.module);
      }
    }
    if (workspace && !current(workspace)) {
      const win = workspace.root.closest(".window");
      window.PanthoriumWindowManager?.close?.(WINDOW_ID);
      if (workspace) disposeWorkspace();
      win?.remove(); os()?.windows?.delete(WINDOW_ID);
    }
    menu();
  }
  window.PanthoriumSocial = {
    open,
    renderMenu: menu,
    showNotifications,
    refreshNotifications,
    renderCard: card,
    refresh: () => refreshView(views.get(workspace?.active)),
    ...Object.fromEntries(
      specs.map(([id]) => [
        "open" + id[0].toUpperCase() + id.slice(1),
        () => open(id),
      ]),
    ),
  };
  for (const event of [
    "panthorium:auth-changed",
    "panthorium:desktop-ready",
    "panthorium:boot-complete",
  ])
    window.addEventListener(event, cleanup);
  window.addEventListener("panthorium:ai-done", (e) => {
    if (
      e.detail?.toolResults?.some(
        (r) => r.toolId === "social.write" && r.ok && !r.error,
      )
    )
      window.PanthoriumSocial.refresh();
  });
  const observe = new MutationObserver(() => {
    for (const [id, v] of views)
      if (!v.root.isConnected) {
        v.controller.abort();
        clearTimeout(v.timer);
        clearTimeout(v.readTimer);
        v.readObserver?.disconnect();
        for (const url of v.urls) URL.revokeObjectURL(url);
        if (v.sessionId) window.PanthoriumSocialRTC?.stop();
        views.delete(id);
      }
  });
  observe.observe(document.body, { childList: true, subtree: true });
  let openedLink = "";
  function deepLink() {
    const p = new URLSearchParams(location.hash.slice(1));
    const key = uid() + location.hash;
    if (p.has("social") && allowed() && key !== openedLink) {
      openedLink = key;
      open(p.get("social"), { recordId: p.get("record") }).catch(() => {
        openedLink = "";
      });
    }
  }
  window.addEventListener("hashchange", deepLink);
  for (const event of ["panthorium:auth-changed", "panthorium:boot-complete"])
    window.addEventListener(event, deepLink);
  deepLink();
  if (document.readyState === "loading")
    document.addEventListener("DOMContentLoaded", menu, { once: true });
  else menu();
})();
