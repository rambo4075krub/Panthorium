const crypto = require("crypto");
const { GoogleAuth } = require("google-auth-library");

const USER_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const NOTE_ID_RE = USER_ID_RE;
const BUCKET_RE = /^[a-z0-9][a-z0-9._-]{1,61}[a-z0-9]$/;
const MAX_NOTE_BYTES = 64 * 1024;
const MAX_NOTE_OBJECTS_PER_USER = 10000;

class CloudNotesError extends Error {
  constructor(status, code) {
    super(code);
    this.name = "CloudNotesError";
    this.status = status;
    this.code = code;
  }
}

function normalizeNote(input = {}) {
  return {
    memoryId: String(input.memoryId || crypto.randomUUID()),
    userId: String(input.userId || ""),
    kind: "note",
    title: String(input.title || "").slice(0, 240),
    content: String(input.content || "").slice(0, 12000),
    tags: Array.isArray(input.tags) ? input.tags.map(value => String(value).slice(0, 64)).slice(0, 20) : [],
    source: input.source ? String(input.source).slice(0, 120) : null,
    importance: Math.min(Math.max(Number(input.importance) || 50, 1), 100),
    createdAt: input.createdAt || new Date().toISOString(),
    updatedAt: input.updatedAt || new Date().toISOString()
  };
}

function noteTerms(query) {
  return [...new Set(String(query || "").toLowerCase().match(/[\p{L}\p{N}_:-]+/gu) || [])]
    .filter(term => term.length > 1)
    .slice(0, 16);
}

async function mapLimit(items, limit, fn) {
  const results = new Array(items.length);
  let next = 0;
  async function worker() {
    while (true) {
      const index = next++;
      if (index >= items.length) return;
      results[index] = await fn(items[index], index);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, () => worker()));
  return results;
}

class CloudNotesRepository {
  constructor({ bucket = process.env.PANTHORIUM_FILES_BUCKET, clientFactory } = {}) {
    this.bucket = String(bucket || "").trim();
    this.clientFactory = clientFactory || (() => new GoogleAuth({
      scopes: ["https://www.googleapis.com/auth/devstorage.read_write"]
    }).getClient());
    this.clientPromise = null;
  }

  ensureConfigured() {
    if (!BUCKET_RE.test(this.bucket)) throw new CloudNotesError(503, "notes_storage_unconfigured");
  }

  ownerPrefix(userId) {
    const id = String(userId || "");
    if (!USER_ID_RE.test(id)) throw new CloudNotesError(403, "account_required");
    return "users/" + id + "/notes/";
  }

  objectName(userId, noteId) {
    if (!NOTE_ID_RE.test(String(noteId || ""))) throw new CloudNotesError(400, "invalid_memory_id");
    return this.ownerPrefix(userId) + noteId + ".json";
  }

  objectsUrl() {
    return "https://storage.googleapis.com/storage/v1/b/" + encodeURIComponent(this.bucket) + "/o";
  }

  async client() {
    if (!this.clientPromise) this.clientPromise = Promise.resolve(this.clientFactory());
    return this.clientPromise;
  }

  async request(options, notFoundCode = "note_not_found") {
    this.ensureConfigured();
    try {
      const client = await this.client();
      const response = await client.request(options);
      return response.data;
    } catch (error) {
      const status = Number(error && error.response && error.response.status);
      if (status === 404) throw new CloudNotesError(404, notFoundCode);
      if (status === 403) throw new CloudNotesError(503, "notes_storage_permission_denied");
      if (status === 412) throw new CloudNotesError(409, "note_conflict");
      throw new CloudNotesError(503, "notes_storage_unavailable");
    }
  }

  async write(item) {
    const body = Buffer.from(JSON.stringify(normalizeNote(item)), "utf8");
    if (body.length > MAX_NOTE_BYTES) throw new CloudNotesError(413, "note_too_large");
    const objectName = this.objectName(item.userId, item.memoryId);
    const uploadUrl = "https://storage.googleapis.com/upload/storage/v1/b/" + encodeURIComponent(this.bucket) + "/o";
    await this.request({
      url: uploadUrl,
      method: "POST",
      params: { uploadType: "media", name: objectName },
      headers: { "Content-Type": "application/json; charset=utf-8" },
      data: body
    }, "notes_storage_unavailable");
    return normalizeNote(item);
  }

  async get(userId, noteId) {
    const objectName = this.objectName(userId, noteId);
    let data;
    try {
      data = await this.request({
        url: this.objectsUrl() + "/" + encodeURIComponent(objectName),
        method: "GET",
        params: { alt: "media" },
        responseType: "arraybuffer"
      });
    } catch (error) {
      if (error instanceof CloudNotesError && error.code === "note_not_found") return null;
      throw error;
    }

    let item;
    try {
      const bytes = Buffer.isBuffer(data) ? data : Buffer.from(data || []);
      item = JSON.parse(bytes.toString("utf8"));
    } catch (_) {
      throw new CloudNotesError(503, "notes_storage_corrupt");
    }
    if (!item || String(item.memoryId) !== String(noteId) || String(item.userId) !== String(userId) || item.kind !== "note") {
      throw new CloudNotesError(503, "notes_storage_corrupt");
    }
    return normalizeNote(item);
  }

  async list(userId, limit = 100) {
    const prefix = this.ownerPrefix(userId);
    const safeLimit = Math.min(Math.max(Number(limit) || 100, 1), MAX_NOTE_OBJECTS_PER_USER);
    const entries = [];
    let pageToken;
    for (let page = 0; page < 100; page += 1) {
      const params = { prefix, maxResults: 1000, fields: "items(name,updated,timeCreated),nextPageToken" };
      if (pageToken) params.pageToken = pageToken;
      const data = await this.request({ url: this.objectsUrl(), method: "GET", params }, "notes_storage_unavailable");
      for (const item of (data && data.items) || []) {
        if (typeof item.name !== "string" || !item.name.startsWith(prefix)) continue;
        const relative = item.name.slice(prefix.length);
        const match = relative.match(/^([0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})\.json$/i);
        if (match) entries.push({ id: match[1], updatedAt: item.updated || item.timeCreated || "" });
      }
      if (entries.length > MAX_NOTE_OBJECTS_PER_USER) throw new CloudNotesError(413, "notes_count_limit");
      pageToken = data && data.nextPageToken;
      if (!pageToken) break;
      if (page === 99) throw new CloudNotesError(413, "notes_count_limit");
    }

    entries.sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
    const selected = entries.slice(0, safeLimit);
    const notes = await mapLimit(selected, 12, entry => this.get(userId, entry.id));
    return notes.filter(Boolean).sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt));
  }

  async create(input) {
    return this.write(normalizeNote({ ...input, kind: "note" }));
  }

  async update(userId, noteId, patch = {}) {
    const current = await this.get(userId, noteId);
    if (!current) return null;
    const item = normalizeNote({
      ...current,
      ...patch,
      userId: current.userId,
      memoryId: current.memoryId,
      kind: "note",
      updatedAt: new Date().toISOString()
    });
    return this.write(item);
  }

  async delete(userId, noteId) {
    const objectName = this.objectName(userId, noteId);
    try {
      await this.request({ url: this.objectsUrl() + "/" + encodeURIComponent(objectName), method: "DELETE" });
      return true;
    } catch (error) {
      if (error instanceof CloudNotesError && error.code === "note_not_found") return false;
      throw error;
    }
  }

  async search(userId, query, limit = 10) {
    const terms = noteTerms(query);
    if (!terms.length) return [];
    const safeLimit = Math.min(Math.max(Number(limit) || 10, 1), 30);
    const notes = await this.list(userId, MAX_NOTE_OBJECTS_PER_USER);
    return notes.map(item => {
      const haystack = (item.title + "\n" + item.content + "\n" + item.tags.join(" ")).toLowerCase();
      const relevance = terms.reduce((score, term) => score + (haystack.includes(term) ? 1 : 0), 0);
      return { item, relevance };
    }).filter(entry => entry.relevance > 0)
      .sort((a, b) => b.relevance - a.relevance || b.item.importance - a.item.importance || Date.parse(b.item.updatedAt) - Date.parse(a.item.updatedAt))
      .slice(0, safeLimit)
      .map(entry => entry.item);
  }
}

module.exports = {
  CloudNotesRepository,
  CloudNotesError,
  normalizeNote,
  noteTerms
};
