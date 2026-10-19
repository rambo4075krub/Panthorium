const assert = require("node:assert/strict");
const http = require("node:http");
const express = require("express");
const { CloudFilesService } = require("../services/cloudFilesService");
const { createFilesRouter } = require("../routes/files");

async function main() {
  const { folderListing } = require('../services/fileFolders');
  const samples = [ ['a.png','images'], ['v.mp4','videos'], ['a.docx','documents'], ['b.xlsx','spreadsheets'], ['c.pptx','presentations'], ['d.print.html','print'], ['x.mp3','audio'], ['a.zip','archives'], ['a.json','code'], ['x.bin','other'] ];
  const grouping = folderListing(samples.map(([name], i) => ({ id: String(i), name, size: 1 })));
  assert.deepEqual(grouping.files.map(f => f.folderId), samples.map(s => s[1]));
  assert.equal(grouping.folders.length, 10);
  assert.ok(grouping.folders.every(f => f.count === 1));
  assert.ok(folderListing([]).folders.every(f => f.count === 0));

  const objects = new Map();
  const requests = [];
  const client = {
    async request(options) {
      requests.push(options);
      const method = String(options.method || "GET").toUpperCase();
      const params = options.params || {};
      if (options.url.includes("/upload/storage/v1/") && method === "POST") {
        objects.set(params.name, { name: params.name, body: Buffer.from(options.data), size: String(options.data.length), contentType: options.headers["Content-Type"], timeCreated: "2026-10-05T00:00:00.000Z" });
        return { data: { name: params.name } };
      }
      if (options.url.endsWith("/o") && method === "GET") {
        let items = [...objects.values()].filter(item => item.name.startsWith(params.prefix || ""));
        if (params.maxResults) items = items.slice(0, Number(params.maxResults));
        return { data: { items } };
      }
      if (options.url.includes("/o/") && method === "GET" && params.alt === "media") {
        const objectName = decodeURIComponent(options.url.split("/o/")[1]);
        const item = objects.get(objectName);
        if (!item) { const error = new Error("not found"); error.response = { status: 404 }; throw error; }
        return { data: item.body };
      }
      if (options.url.includes("/o/") && method === "DELETE") {
        const objectName = decodeURIComponent(options.url.split("/o/")[1]);
        if (!objects.has(objectName)) { const error = new Error("not found"); error.response = { status: 404 }; throw error; }
        objects.delete(objectName);
        return { data: null };
      }
      throw new Error("unexpected mocked storage request: " + method + " " + options.url);
    }
  };
  const files = new CloudFilesService({ bucket: "panthorium-test-files", clientFactory: async () => client });
  const accounts = {
    alice: { sub: "11111111-1111-4111-8111-111111111111", roles: [], permissions: [] },
    bob: { sub: "22222222-2222-4222-8222-222222222222", roles: [], permissions: [] },
    guest: { sub: "guest:33333333-3333-4333-8333-333333333333", roles: ["guest"], permissions: [] }
  };
  const authService = { verifyAccessToken(token) { if (!accounts[token]) throw new Error("invalid token"); return accounts[token]; } };
  const app = express();
  app.use("/api/files", createFilesRouter(authService, files));
  const server = http.createServer(app);
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const base = "http://127.0.0.1:" + server.address().port + "/api/files";
  async function close() { await new Promise(resolve => server.close(resolve)); }
  async function call(path, token, init = {}) {
    return fetch(base + path, { ...init, headers: { Authorization: "Bearer " + token, ...(init.headers || {}) } });
  }
  try {
    const guest = await call("", "guest");
    assert.equal(guest.status, 403, "Guest cannot use cloud files");

    const upload = await call("", "alice", {
      method: "POST",
      headers: { "Content-Type": "application/octet-stream", "X-File-Name": encodeURIComponent("private note.txt"), "X-File-Content-Type": "text/plain" },
      body: Buffer.from("Alice-only test")
    });
    assert.equal(upload.status, 201);
    const created = await upload.json();
    assert.equal(created.file.name, "private note.txt");
    assert.equal(objects.size, 1);
    const objectName = [...objects.keys()][0];
    assert.ok(objectName.startsWith("users/" + accounts.alice.sub + "/files/"));
    assert.ok(!objectName.includes(accounts.bob.sub));

    const aliceList = await (await call("", "alice")).json();
    const bobList = await (await call("", "bob")).json();
    assert.equal(aliceList.files.length, 1);
    assert.equal(bobList.files.length, 0, "another account cannot list Alice's objects");

    const denied = await call("/" + created.file.id, "bob");
    assert.equal(denied.status, 404, "another account cannot discover or download Alice's object");
    const own = await call("/" + created.file.id, "alice");
    assert.equal(own.status, 200);
    assert.equal(await own.text(), "Alice-only test");

    // Preview remains available when export/download allowance is zero.
    let quotaReads = 0, quotaCharges = 0;
    files.entitlements = { state: async () => { quotaReads++; return { remaining: { downloadBytes: 0 } }; }, consume: async () => { quotaCharges++; } };
    const preview = await call('/' + created.file.id + '/preview', 'alice');
    assert.equal(preview.status, 200);
    assert.equal(await preview.text(), 'Alice-only test');
    assert.equal(preview.headers.get('cache-control'), 'private, no-store');
    assert.equal(preview.headers.get('x-content-type-options'), 'nosniff');
    assert.match(preview.headers.get('content-security-policy'), /sandbox/);
    assert.equal(quotaReads, 0); assert.equal(quotaCharges, 0);
    const exportDenied = await call('/' + created.file.id, 'alice');
    assert.equal(exportDenied.status, 402);
    assert.equal((await exportDenied.json()).error, 'quota_exceeded:downloadBytes');
    assert.equal((await call('/' + created.file.id + '/preview', 'bob')).status, 404);
    assert.equal((await call('/' + created.file.id + '/preview', 'guest')).status, 403);
    assert.equal((await call('/' + created.file.id + '/preview', 'invalid')).status, 401);
    const item = objects.get(objectName);
    item.size = String(21 * 1024 * 1024);
    const readsBefore = requests.filter(r => r.params?.alt === 'media').length;
    assert.equal((await call('/' + created.file.id + '/preview', 'alice')).status, 413);
    assert.equal(requests.filter(r => r.params?.alt === 'media').length, readsBefore);
    item.size = String(item.body.length);
    files.entitlements = null;
    const core = require('../services/officeArtifactService')._internals;
    const workbook = core.spreadsheetBuffer({title:'ตาราง',sheets:[{name:'ข้อมูล',rows:[['ชื่อ','ค่า'],['สินค้า',100]]}]});
    const sheet = await files.upload(accounts.alice.sub, 'ตาราง.xlsx', 'application/octet-stream', workbook);
    const sheetPreview = await call('/' + sheet.id + '/preview', 'alice');
    assert.equal(sheetPreview.status, 200);
    assert.equal(sheetPreview.headers.get('x-panthorium-preview'), 'office-text');
    assert.match(await sheetPreview.text(), /สินค้า\t100/);
    await files.remove(accounts.alice.sub, sheet.id);
    const unknown = await files.upload(accounts.alice.sub, 'archive.zip', 'application/zip', Buffer.from('zip'));
    assert.equal((await call('/' + unknown.id + '/preview', 'alice')).status, 415);
    await files.remove(accounts.alice.sub, unknown.id);

    const deleteDenied = await call("/" + created.file.id, "bob", { method: "DELETE" });
    assert.equal(deleteDenied.status, 404, "another account cannot delete Alice's object");
    const removed = await call("/" + created.file.id, "alice", { method: "DELETE" });
    assert.equal(removed.status, 200);
    assert.equal(objects.size, 0);
    assert.ok(requests.some(request => request.url.includes("storage.googleapis.com")));

    const unconfigured = new CloudFilesService({ bucket: "" });
    await assert.rejects(() => unconfigured.list(accounts.alice.sub), error => error.code === "files_storage_unconfigured");
  } finally {
    await close();
  }
  console.log("Cloud files API: account isolation, Guest denial, upload/download/delete and bucket configuration passed");
}

main().catch(error => { console.error(error); process.exitCode = 1; });
