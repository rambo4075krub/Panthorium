const assert = require("node:assert/strict");
const { CloudNotesRepository } = require("../services/cloudNotesRepository");

async function main() {
  const objects = new Map();
  const requests = [];
  const client = {
    async request(options) {
      requests.push(options);
      const method = String(options.method || "GET").toUpperCase();
      const params = options.params || {};
      if (options.url.includes("/upload/storage/v1/") && method === "POST") {
        const name = params.name;
        const body = Buffer.from(options.data);
        objects.set(name, { name, body, updated: new Date().toISOString() });
        return { data: { name } };
      }
      if (options.url.endsWith("/o") && method === "GET") {
        const items = [...objects.values()]
          .filter(item => item.name.startsWith(params.prefix || ""))
          .map(item => ({ name: item.name, updated: item.updated, timeCreated: item.updated }));
        return { data: { items } };
      }
      if (options.url.includes("/o/") && method === "GET" && params.alt === "media") {
        const name = decodeURIComponent(options.url.split("/o/")[1]);
        const item = objects.get(name);
        if (!item) {
          const error = new Error("not found");
          error.response = { status: 404 };
          throw error;
        }
        return { data: item.body };
      }
      if (options.url.includes("/o/") && method === "DELETE") {
        const name = decodeURIComponent(options.url.split("/o/")[1]);
        if (!objects.has(name)) {
          const error = new Error("not found");
          error.response = { status: 404 };
          throw error;
        }
        objects.delete(name);
        return { data: null };
      }
      throw new Error("unexpected mocked request: " + method + " " + options.url);
    }
  };

  const repository = new CloudNotesRepository({
    bucket: "panthorium-test-files",
    clientFactory: async () => client
  });
  const alice = "11111111-1111-4111-8111-111111111111";
  const bob = "22222222-2222-4222-8222-222222222222";

  const created = await repository.create({
    userId: alice,
    title: "Trip plan",
    content: "Project meeting in Bangkok",
    tags: ["travel"],
    importance: 80,
    source: "notes-app"
  });
  assert.equal(created.kind, "note");
  assert.ok(created.memoryId);
  assert.equal(objects.size, 1);
  assert.ok([...objects.keys()][0].startsWith("users/" + alice + "/notes/"));

  const aliceNotes = await repository.list(alice, 100);
  const bobNotes = await repository.list(bob, 100);
  assert.equal(aliceNotes.length, 1);
  assert.equal(aliceNotes[0].content, "Project meeting in Bangkok");
  assert.deepEqual(bobNotes, []);
  assert.equal(await repository.get(bob, created.memoryId), null);
  assert.equal(await repository.delete(bob, created.memoryId), false);

  const found = await repository.search(alice, "meeting Bangkok", 10);
  assert.equal(found.length, 1);
  assert.equal(found[0].memoryId, created.memoryId);
  assert.deepEqual(await repository.search(bob, "meeting", 10), []);

  const updated = await repository.update(alice, created.memoryId, { content: "Project meeting moved to Chiang Mai", importance: 95 });
  assert.equal(updated.content, "Project meeting moved to Chiang Mai");
  assert.equal(updated.importance, 95);
  assert.equal((await repository.get(alice, created.memoryId)).content, updated.content);

  assert.equal(await repository.delete(alice, created.memoryId), true);
  assert.equal(await repository.get(alice, created.memoryId), null);
  assert.equal(objects.size, 0);
  assert.ok(requests.every(request => request.url.startsWith("https://storage.googleapis.com/")));

  const unconfigured = new CloudNotesRepository({ bucket: "" });
  await assert.rejects(() => unconfigured.list(alice), error => error.code === "notes_storage_unconfigured");

  console.log("Cloud Notes repository: bucket persistence, search, update/delete, and account isolation passed");
}

main().catch(error => { console.error(error); process.exitCode = 1; });
