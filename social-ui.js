(function () {
  "use strict";
  const specs = [
    ["watch", "Watch", "วิดีโอ", "▶"],
    ["community", "Community", "โพสต์และชุมชน", "◉"],
    ["talk", "Talk", "ข้อความและการโทร", "☏"],
    ["market", "Market", "ร้านค้า", "▣"],
    ["live", "Live", "ถ่ายทอดสด", "◉"],
    ["connect", "Connect", "ทำความรู้จัก 18+", "♡"],
  ];
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
    social_video_required: "Watch ต้องแนบวิดีโอ MP4 หรือ WebM",
    social_live_capacity: "ห้องนี้ครบจำนวนผู้ชม 8 คนแล้ว",
    social_invalid_order: "จำนวนสินค้าไม่พอหรือรายการไม่พร้อมขาย",
    social_connect_disabled: "ฝ่ายใดฝ่ายหนึ่งปิด Connect แล้ว",
    social_name_required: "กรุณาระบุชื่อที่แสดง",
    social_invalid_product: "ตรวจราคาและจำนวนสินค้า",
  };
  const friendly = (e) =>
    messages[e.message] || e.message || "ดำเนินการไม่สำเร็จ";
  function status(v, text) {
    if (current(v)) v.status.textContent = text;
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
      s = el("select");
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
      if (record.kind === "watch" || (record.kind === "group-message" && /^(image\/(png|jpeg|webp|gif)|video\/|audio\/)/.test(file.contentType))) {
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
    const f = section(v, "โปรไฟล์ Social Media"),
      form = el("form");
    f.append(form);
    const name = input(form, "ชื่อที่แสดง", "text", data.profile?.name || ""),
      bio = input(form, "เกี่ยวกับฉัน", "textarea", data.profile?.bio || ""),
      visible = input(
        form,
        "อนุญาตให้คนอื่นค้นหาโปรไฟล์และขอสนทนา",
        "checkbox",
      );
    visible.checked = !!data.profile?.discoverable;
    name.maxLength = 80;
    bio.maxLength = 1000;
    bindForm(
      v,
      form,
      "profile",
      () => ({
        name: name.value,
        bio: bio.value,
        discoverable: visible.checked,
      }),
      () => feed(v),
    );
    f.append(
      el(
        "p",
        "ใช้ชื่อ Social แยกจากบัญชีส่วนตัว ไม่เปิดเผยอีเมลหรือไฟล์ที่ไม่ได้แชร์",
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
      () => feed(v),
    );
    submit.textContent = v.module === "market" ? "ลงสินค้า" : "เผยแพร่";
  }
  async function people(v) {
    clear(v);
    const card = section(v, "ค้นหาคนใน Panthorium"),
      form = el("form"),
      q = input(form, "ชื่อที่แสดงอย่างน้อย 2 ตัวอักษร"),
      results = el("div");
    card.append(form, results);
    const b = el("button", "ค้นหา", { type: "submit" });
    form.append(b);
    form.onsubmit = async (e) => {
      e.preventDefault();
      b.disabled = true;
      try {
        const data = await api(
          v,
          "/api/social/people?query=" + encodeURIComponent(q.value),
        );
        if (!current(v)) return;
        results.replaceChildren();
        for (const p of data.items) {
          const item = el("article", null, { class: "social-card" });
          item.append(
            el("h4", p.name),
            el("p", p.bio),
            button(v, "ขอสนทนา", async () => {
              const out = await write(v, "thread", { userId: p.id });
              await open("talk", { recordId: out.record.id });
            }),
            button(v, "ติดตาม", async () => {
              await write(v, "follow", { userId: p.id, enabled: true });
              status(v, "ติดตามแล้ว");
            }),
            button(v, "เลิกติดตาม", async () => {
              await write(v, "follow", { userId: p.id, enabled: false });
              status(v, "เลิกติดตามแล้ว");
            }),
            button(v, "บล็อก", async () => {
              await write(v, "block", { userId: p.id, enabled: true });
              item.remove();
            }),
            button(v, "เลิกบล็อก", async () => {
              await write(v, "block", { userId: p.id, enabled: false });
              status(v, "เลิกบล็อกแล้ว");
            }),
          );
          results.append(item);
        }
        if (!data.items.length)
          results.append(el("p", "ไม่พบโปรไฟล์ที่เปิดให้ค้นหา"));
      } catch (e) {
        status(v, friendly(e));
      } finally {
        b.disabled = false;
      }
    };
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
      el("h3", r.title || r.name || "Talk"),
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
            await open("talk", { recordId: t.record.id });
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
    if (r.kind === "watch")
      c.append(
        button(v, "เพิ่มลงเพลย์ลิสต์", () => collections(v, "playlist", r.id)),
      );
    if (
      r.ownerId === v.uid &&
      ["community", "watch", "listing"].includes(r.kind)
    )
      c.append(button(v, "แก้ไข", () => edit(v, r)));
    if (
      r.ownerId === v.uid &&
      ["community", "watch", "listing"].includes(r.kind)
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
      c.append(
        button(v, "ขอสนทนากับเจ้าของ", async () => {
          const t = await write(v, "thread", {
            userId: r.ownerId,
            title: r.title || "Talk",
          });
          await open("talk", { recordId: t.record.id });
        }),
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
    c.append(
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
    c.append(
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
    if (["watch", "community", "listing"].includes(r.kind))
      inlineComments(v, r, c, commentData);
  }
  async function detail(v, id, reset = true) {
    if (reset) clear(v);
    v.detail = id;
    const data = await api(v, "/api/social/records/" + encodeURIComponent(id));
    if (!current(v) || v.detail !== id) return;
    const r = data.record;
    if (["watch", "community", "listing"].includes(r.kind)) {
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
      ["community", "watch", "listing"].includes(r.kind)
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
    const getFiles = await attachments(v, form);
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
    const getFiles = await attachments(v, f);
    bindForm(
      v,
      f,
      "connect",
      () => ({
        enabled: true,
        adultConfirmed: adult.checked,
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
  async function personDetail(v, personId) {
    clear(v);
    const data = await api(v, "/api/social/records/" + encodeURIComponent("profile:" + personId));
    const p = data.record, box = section(v, p.name || "สมาชิก");
    box.append(el("p", p.bio || ""), button(v, "ขอสนทนา", async () => {
      const out = await write(v, "thread", { userId: personId });
      await open("talk", { recordId: out.record.id });
    }));
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
      if (v.module === "talk") {
        const data = await api(v, "/api/social/inbox");
        if (!current(v)) return;
        v.incoming.replaceChildren();
        for (const c of data.calls) {
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
      if (v.detail && (v.messageLog?.isConnected || v.groupState)) {
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
  async function feed(v, before) {
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
  async function open(module = "community", options = {}) {
    if (!allowed()) throw Error("account_required");
    if (!specs.some((s) => s[0] === module))
      throw Error("social_invalid_module");
    const key = "social-" + module;
    let v = views.get(module);
    if (v && current(v)) {
      window.focusWindow?.(key);
      if (options.support) await support(v);
      else if (options.orders) await orders(v, options.recordId);
      else if (options.personId) await personDetail(v, options.personId);
      else if (options.recordId) await detail(v, options.recordId);
      if (options.sourceFileIds) {
        v.sourceFileIds = options.sourceFileIds;
        await compose(v);
      }
      return v.root;
    }
    const markup =
      '<div class="social-app" data-social="' +
      module +
      '"><style>.social-app{height:100%;overflow:auto;padding:20px;color:var(--text,#edf2f7);background:linear-gradient(145deg,#10151f,#191710);box-sizing:border-box}.social-app *{box-sizing:border-box}.social-app button,.social-app input,.social-app select,.social-app textarea{font:inherit;color:inherit;background:#17202d;border:1px solid #66503d;border-radius:9px;padding:9px;max-width:100%}.social-app button{cursor:pointer;margin:4px;min-height:40px}.social-app button:hover{border-color:#ff912e}.social-app button:disabled{opacity:.5}.social-app label{display:block;margin:10px 0}.social-app label input:not([type=checkbox]),.social-app textarea,.social-app select{display:block;width:100%;margin-top:5px}.social-app textarea{min-height:90px}.social-app option{background:#17202d;color:#fff}.social-app h1{color:#ffb26e;font-size:26px}.social-app nav{display:flex;flex-wrap:wrap;gap:4px}.social-card{border:1px solid #514637;border-radius:14px;padding:16px;margin:12px 0;background:#111923}.social-card p,.social-message p{white-space:pre-wrap;overflow-wrap:anywhere}.social-comments{border-top:1px solid #3e4146;margin-top:16px;padding-top:16px}.social-message{padding:12px;border-bottom:1px solid #3e4146}.social-app small{color:#b5becb;overflow-wrap:anywhere}.social-app [role=status]{min-height:24px;color:#ffb26e}.social-media img,.social-media video{display:block;max-width:100%;max-height:420px}.social-media pre{white-space:pre-wrap;max-height:420px;overflow:auto}.social-video-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:8px}.social-message-receipt{display:inline-block;margin:4px 8px;color:#9bb1c9;font-size:18px;font-weight:600}.social-message-receipt[data-delivery="read"]{letter-spacing:-6px;padding-right:6px;color:#66d0ff}.social-video-grid video{width:100%;max-height:400px;background:#000}.social-app [hidden]{display:none!important}@media(max-width:540px){.social-app{padding:10px}.social-card{padding:12px}}</style><header><small>PANTHORIUM / SOCIAL MEDIA</small><h1>' +
      specs.find((s) => s[0] === module)[1] +
      '</h1></header><nav data-social-nav></nav><p role="status" aria-live="polite"></p><div data-social-incoming></div><section data-social-rtc hidden></section><div data-social-content></div></div>';
    if (typeof window.createWindow !== "function")
      throw Error("window_system_unavailable");
    window.createWindow(
      key,
      "Social Media · " + specs.find((s) => s[0] === module)[1],
      markup,
      {
        width: 940,
        height: 720,
        onClose: () => {
          const old = views.get(module);
          if (old) {
            if (old.sessionId) window.PanthoriumSocialRTC?.stop();
            old.controller.abort();
            clearTimeout(old.timer);
            clearTimeout(old.readTimer);
            old.readObserver?.disconnect();
            for (const url of old.urls) URL.revokeObjectURL(url);
            views.delete(module);
          }
        },
      },
    );
    const root = document.querySelector(
      '.window[data-id="' + key + '"] [data-social]',
    );
    if (!root) throw Error("window_system_unavailable");
    v = {
      uid: uid(),
      root,
      module,
      controller: new AbortController(),
      urls: new Set(),
      sourceFileIds: options.sourceFileIds || [],
      status: root.querySelector("[role=status]"),
      content: root.querySelector("[data-social-content]"),
      incoming: root.querySelector("[data-social-incoming]"),
      rtc: root.querySelector("[data-social-rtc]"),
    };
    views.set(module, v);
    root.addEventListener("scroll", () => scheduleRead(v), { capture: true, signal: v.controller.signal });
    root.addEventListener("pointerup", () => scheduleRead(v), { signal: v.controller.signal });
    window.addEventListener("focus", () => scheduleRead(v), { signal: v.controller.signal });
    document.addEventListener("visibilitychange", () => scheduleRead(v), { signal: v.controller.signal });
    const nav = root.querySelector("nav");
    for (const [id, label] of specs)
      nav.append(button(v, label, () => open(id)));
    const alerts = button(v, "การแจ้งเตือน", () => showNotifications(v));
    alerts.dataset.socialOpenNotifications = "";
    alerts.setAttribute("aria-expanded", "false");
    alerts.setAttribute("aria-controls", "social-notification-center");
    alerts.append(notificationBadge()); nav.append(alerts); notificationBadges();
    nav.append(
      button(v, "โปรไฟล์", () => profile(v)),
      button(v, "ค้นหาคน", () => people(v)),
      button(v, "รีเฟรช", () => feed(v)),
    );
    v.search = input(nav, "ค้นหารายการ");
    nav.append(button(v, "ค้นหา", () => feed(v)));
    if (["watch", "community", "market"].includes(module))
      nav.append(
        button(v, module === "market" ? "ลงสินค้า" : "สร้างโพสต์", () =>
          compose(v),
        ),
      );
    if (module === "community")
      nav.append(button(v, "กลุ่ม", () => collections(v, "group")));
    if (module === "watch")
      nav.append(button(v, "เพลย์ลิสต์", () => collections(v, "playlist")));
    nav.append(button(v, "บัญชีที่บล็อก", () => collections(v, "block")));
    if (module === "market")
      nav.append(button(v, "รายการซื้อขาย", () => orders(v)));
    if (module === "connect")
      nav.append(button(v, "ตั้งค่า Connect", () => connectSettings(v)));
    if (module === "live")
      nav.append(
        button(v, "เริ่มไลฟ์", async () => {
          clear(v);
          const form = el("form"),
            title = input(form, "ชื่อไลฟ์");
          section(v, "เริ่มถ่ายทอดสด • ผู้ชมพร้อมกันสูงสุด 8 คน").append(form);
          bindForm(
            v,
            form,
            "live-start",
            () => ({ title: title.value }),
            async (out) => {
              await startRTC(v, out.record);
              await detail(v, out.record.id);
            },
          );
        }),
      );
    const apps = select(nav, "เปิดเครื่องมือ Panthorium ที่เชื่อมงาน", [
      ["", "เลือกเครื่องมือ"],
      ...(window.PanthoriumWindowCatalog?.apps || [])
        .filter(
          (a) =>
            !a.virtual &&
            !a.native &&
            !a.id.startsWith("social-") &&
            window.PanthoriumWindowCatalog.allowed(a, os().state.user),
        )
        .map((a) => [a.key, a.label]),
    ]);
    apps.onchange = () => {
      if (apps.value)
        window.PanthoriumVoiceCommands?.windowAction("open_" + apps.value);
      apps.value = "";
    };
    try {
      if (options.support) await support(v);
      else if (options.orders) await orders(v, options.recordId);
      else if (options.personId) await personDetail(v, options.personId);
      else if (options.recordId) await detail(v, options.recordId);
      else if (v.sourceFileIds.length) await compose(v);
      else await feed(v);
    } catch (error) {
      status(v, friendly(error));
    }
    if (["talk", "live", "community"].includes(module)) poll(v);
    return root;
  }
  let notificationState;
  function notificationStyles() {
    if (document.getElementById("social-notification-style")) return;
    const style = el("style", `
      .social-notification-badge{display:inline-block;min-width:19px;padding:1px 5px;margin-left:6px;border-radius:20px;background:#ff9f43;color:#101820;font:700 11px/18px system-ui;text-align:center}
      #social-notification-center{position:relative;width:100%;margin:16px 0;max-height:min(60dvh,620px);overflow:auto;box-sizing:border-box;padding:16px;border:1px solid #42647a;border-radius:18px;background:#0d1926;color:#edf4ff;box-shadow:0 14px 48px #0009;font:14px/1.5 system-ui}
      #social-notification-center header{display:flex;align-items:center;justify-content:space-between;gap:12px}#social-notification-center h2{font-size:18px;margin:0}
      #social-notification-center button,.social-notification-menu{font:inherit;color:inherit;background:#163044;border:1px solid #42647a;border-radius:9px;min-height:40px;padding:8px;cursor:pointer}#social-notification-center button:disabled{opacity:.5}
      #social-notification-center button:focus-visible{outline:2px solid #66d0ff;outline-offset:2px}
      #social-notification-center article{padding:12px 0;border-bottom:1px solid #314354;overflow-wrap:anywhere}#social-notification-center article[data-unread=true]{border-left:3px solid #ff9f43;padding-left:10px}
      #social-notification-center p{margin:4px 0}#social-notification-center small{color:#b5c7d8}#social-notification-center .social-notification-actions{display:flex;gap:6px;flex-wrap:wrap;margin-top:8px}
      .social-notification-menu{display:block;width:100%;text-align:left;margin:4px 0}#social-notification-center [hidden],.social-notification-badge[hidden]{display:none!important}
    `, { id: "social-notification-style" });
    document.head.append(style);
  }
  function notificationBadges() {
    const data = notificationState?.data || {};
    for (const node of document.querySelectorAll("[data-social-notification-count]")) {
      const count = data.unreadCount || 0;
      node.textContent = count > 99 ? "99+" : String(count);
      node.hidden = count === 0;
      node.setAttribute("aria-label", count + " การแจ้งเตือนยังไม่อ่าน");
    }
    for (const node of document.querySelectorAll("[data-social-module-count]")) {
      const count = data.counts?.[node.dataset.socialModuleCount] || 0;
      node.textContent = count > 99 ? "99+" : String(count);
      node.hidden = count === 0;
    }
    for (const trigger of document.querySelectorAll("[data-social-open-notifications]"))
      trigger.setAttribute("aria-label", "การแจ้งเตือน Social Media • ยังไม่อ่าน " + (data.unreadCount || 0) + " รายการ");
  }
  const notificationBadge = () => el("span", "", { class: "social-notification-badge", "data-social-notification-count": "", hidden: "" });
  function closeNotifications() {
    const n = notificationState;
    if (!n?.panel) return;
    n.panel.remove(); n.panel = null;
    n.trigger?.setAttribute("aria-expanded", "false");
    if (n.returnFocus?.isConnected) n.returnFocus.focus();
  }
  async function readNotifications(n, ids) {
    if (!ids.length) return;
    await api(n, "/api/social/notifications/read", { method: "POST", body: JSON.stringify({ ids }) });
    await refreshNotifications();
  }
  async function navigateNotification(n, item) {
    if (!item.readAt) await readNotifications(n, [item.id]);
    if (!current(n)) return;
    closeNotifications();
    if (item.target) await open(item.target.module, item.target);
  }
  function drawNotifications(n) {
    if (!current(n) || !n.panel?.isConnected) return;
    const panel = n.panel;
    const focusId = panel.contains(document.activeElement) ? document.activeElement.dataset.notificationFocus : null;
    panel.replaceChildren();
    const header = el("header"), title = el("h2", "การแจ้งเตือน Social Media");
    const close = button(n, "ปิด", closeNotifications); close.dataset.notificationFocus = "close";
    header.append(title, close); panel.append(header);
    panel.append(el("p", "ยังไม่อ่าน " + (n.data?.unreadCount || 0) + " รายการ"));
    n.status = el("p", n.error || "", { role: "status", "aria-live": "polite" }); panel.append(n.status);
    const toolbar = el("div", null, { class: "social-notification-actions" });
    const refresh = button(n, "รีเฟรช", () => refreshNotifications()); refresh.dataset.notificationFocus = "refresh";
    toolbar.append(refresh);
    const items = n.pageItems || n.data?.items || [];
    const ids = items.filter(x => !x.readAt).map(x => x.id);
    if (ids.length) {
      const all = button(n, "อ่านทั้งหมดในหน้านี้", () => readNotifications(n, ids.slice(0, 100)));
      all.dataset.notificationFocus = "read-page"; toolbar.append(all);
    }
    panel.append(toolbar);
    if (!items.length) panel.append(el("p", n.error ? "โหลดรายการไม่สำเร็จ กรุณาลองอีกครั้ง" : "ยังไม่มีการแจ้งเตือน"));
    for (const item of items) {
      const row = el("article", null, { "data-notification-id": item.id, "data-unread": String(!item.readAt) });
      row.append(el("p", item.name + " • " + item.text), el("small", new Date(item.createdAt).toLocaleString("th-TH")));
      if (item.reason) row.append(el("p", item.reason));
      const actions = el("div", null, { class: "social-notification-actions" });
      if (item.target) {
        const go = button(n, "เปิดรายการ", () => navigateNotification(n, item));
        go.dataset.notificationFocus = item.id; actions.append(go);
      }
      if (!item.readAt) {
        const read = button(n, "อ่านแล้ว", () => readNotifications(n, [item.id]));
        read.dataset.notificationFocus = "read:" + item.id; actions.append(read);
      }
      row.append(actions); panel.append(row);
    }
    if (n.pageCursor) {
      panel.append(button(n, "รายการล่าสุด", async () => { n.pageCursor = null; n.pageItems = null; await refreshNotifications(); }));
    }
    const cursor = n.pageCursor ? n.nextCursor : n.data?.nextCursor;
    if (cursor) panel.append(button(n, "รายการก่อนหน้า", async () => {
      const data = await api(n, "/api/social/notifications?before=" + encodeURIComponent(cursor));
      n.pageCursor = cursor; n.nextCursor = data.nextCursor; n.pageItems = data.items; drawNotifications(n);
    }));
    if (focusId) [...panel.querySelectorAll("[data-notification-focus]")].find(x => x.dataset.notificationFocus === focusId)?.focus({ preventScroll: true });
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
        const newItems = (data.items || []).filter(x => !x.readAt && !n.seen.has(x.id));
        if (n.initialized && newItems.length && document.visibilityState === "visible" && typeof toast === "function")
          toast("มีการแจ้งเตือน Social Media ใหม่ " + newItems.length + " รายการ • เปิดการแจ้งเตือนใน Social Media", 5000);
        for (const item of data.items || []) n.seen.add(item.id);
        // Bound the in-memory deduplication cache; the server stores read state.
        if (n.seen.size > 1000) n.seen = new Set((data.items || []).map(x => x.id));
        const changed = JSON.stringify(n.data) !== JSON.stringify(data) || n.error;
        n.data = data; n.error = ""; n.initialized = true;
        notificationBadges();
        if (n.pageCursor && n.panel?.isConnected) {
          const page = await api(n, "/api/social/notifications?before=" + encodeURIComponent(n.pageCursor));
          n.pageItems = page.items; n.nextCursor = page.nextCursor; drawNotifications(n);
        } else if (changed) drawNotifications(n);
      } catch (e) {
        if (current(n)) { n.error = "เชื่อมต่อการแจ้งเตือนไม่สำเร็จ จะลองใหม่อัตโนมัติ"; drawNotifications(n); }
      } finally {
        n.polling = null;
        if (current(n) && n === notificationState) n.timer = setTimeout(refreshNotifications, n.error ? 30000 : document.visibilityState === "hidden" ? 30000 : 5000);
      }
    })();
    return n.polling;
  }
  async function showNotifications(v) {
    syncNotifications();
    const n = notificationState;
    if (!n || !current(n)) return;
    if (!v || !current(v)) {
      await open("talk");
      v = views.get("talk");
    }
    if (!v || !current(v) || !current(n)) return;
    if (n.panel && (!n.panel.isConnected || n.host !== v.root)) closeNotifications();
    if (!n.panel) {
      n.host = v.root;
      n.trigger = v.root.querySelector("[data-social-open-notifications]");
      n.returnFocus = n.trigger;
      n.panel = el("section", null, { id: "social-notification-center", role: "region", "aria-label": "การแจ้งเตือน Social Media", tabindex: "-1" });
      v.root.querySelector("nav").after(n.panel);
      n.trigger?.setAttribute("aria-expanded", "true");
      drawNotifications(n);
    }
    n.panel.scrollIntoView?.({ block: "nearest" });
    n.panel.focus({ preventScroll: true });
    await refreshNotifications();
  }
  function syncNotifications() {
    if (notificationState && !current(notificationState)) {
      const old = notificationState; old.controller.abort(); clearTimeout(old.timer);
      old.panel?.remove(); notificationState = null;
      notificationBadges();
    }
    if (!allowed() || notificationState) return;
    notificationStyles();
    const n = notificationState = { uid: uid(), root: document.body, controller: new AbortController(), seen: new Set(), data: { items: [], unreadCount: 0, counts: {} } };
    document.addEventListener("keydown", e => { if (e.key === "Escape" && n.panel) closeNotifications(); }, { signal: n.controller.signal });
    document.addEventListener("pointerdown", e => { if (n.panel && !n.panel.contains(e.target) && !e.target.closest("[data-social-open-notifications]")) closeNotifications(); }, { signal: n.controller.signal });
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
    if (!g.querySelector(".social-notification-menu")) {
      const entry = el("button", "การแจ้งเตือน", { type: "button", class: "social-notification-menu" });
      entry.append(notificationBadge()); entry.onclick = () => { showNotifications(); document.getElementById("start-menu")?.classList.remove("open"); };
      window.PanthoriumStartMenuUI.groupItems(g).append(entry);
      g.querySelector(".sm-group-label")?.append(notificationBadge());
    }
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
    menu();
  }
  window.PanthoriumSocial = {
    open,
    renderMenu: menu,
    showNotifications,
    refreshNotifications,
    renderCard: card,
    refresh: () =>
      Promise.all([...views.values()].filter(current).map((v) => feed(v))),
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
