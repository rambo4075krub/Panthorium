const crypto = require("crypto");
const { folderFor, folderListing } = require('./fileFolders');
const { GoogleAuth } = require("google-auth-library");

const MAX_FILE_BYTES = 20 * 1024 * 1024;
const MAX_USER_BYTES = 100 * 1024 * 1024;
const MAX_USER_FILES = 1000;
const USER_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const FILE_ID_RE = USER_ID_RE;
const BUCKET_RE = /^[a-z0-9][a-z0-9._-]{1,61}[a-z0-9]$/;

class CloudFilesError extends Error {
  constructor(status, code) {
    super(code);
    this.name = "CloudFilesError";
    this.status = status;
    this.code = code;
  }
}

function sanitizeFilename(input) {
  const value = String(input || "").replace(/[\\/]+/g, "_").replace(/[\u0000-\u001f\u007f]/g, "").trim();
  const clipped = Array.from(value || "file").slice(0, 180).join("");
  return clipped || "file";
}

function safeContentType(input) {
  const value = String(input || "").trim();
  return /^[a-zA-Z0-9][a-zA-Z0-9!#$&^_.+-]*\/[a-zA-Z0-9][a-zA-Z0-9!#$&^_.+-]*$/.test(value)
    ? value
    : "application/octet-stream";
}

class CloudFilesService {
  constructor({ bucket = process.env.PANTHORIUM_FILES_BUCKET, clientFactory, entitlements = null } = {}) {
    this.entitlements = entitlements;
    this.maxUserFiles=entitlements ? 10000 : MAX_USER_FILES;
    this.bucket = String(bucket || "").trim();
    this.clientFactory = clientFactory || (async () => new GoogleAuth({
      scopes: ["https://www.googleapis.com/auth/devstorage.read_write"]
    }).getClient());
    this.clientPromise = null;
    this.probeAt = 0;
    this.probeResult = null;
  }

  ownerPrefix(userId) {
    const id = String(userId || "");
    if (!USER_ID_RE.test(id)) throw new CloudFilesError(403, "account_required");
    return "users/" + id + "/files/";
  }

  ensureConfigured() {
    if (!BUCKET_RE.test(this.bucket)) throw new CloudFilesError(503, "files_storage_unconfigured");
  }

  async client() {
    if (!this.clientPromise) this.clientPromise = Promise.resolve(this.clientFactory());
    return this.clientPromise;
  }

  objectsUrl() {
    return "https://storage.googleapis.com/storage/v1/b/" + encodeURIComponent(this.bucket) + "/o";
  }

  async request(options) {
    this.ensureConfigured();
    try {
      const client = await this.client();
      const response = await client.request(options);
      return response.data;
    } catch (error) {
      const status = Number(error && error.response && error.response.status);
      if (status === 404) throw new CloudFilesError(404, "file_not_found");
      if (status === 403) throw new CloudFilesError(503, "files_storage_permission_denied");
      throw new CloudFilesError(503, "files_storage_unavailable");
    }
  }

  normalizeObject(item, prefix) {
    if (!item || typeof item.name !== "string" || !item.name.startsWith(prefix)) return null;
    const relative = item.name.slice(prefix.length);
    const slash = relative.indexOf("/");
    if (slash < 1) return null;
    const id = relative.slice(0, slash);
    const name = relative.slice(slash + 1);
    if (!FILE_ID_RE.test(id) || !name || name.includes("/")) return null;
    return {
      id,
      name,
      contentType: safeContentType(item.contentType),
      size: Math.max(0, Number(item.size) || 0),
      updatedAt: item.updated || item.timeCreated || null
    };
  }

  async probe({ force = false } = {}) {
    if (!force && this.probeResult && Date.now() - this.probeAt < 30000) return { ...this.probeResult };
    try {
      await this.request({
        url: this.objectsUrl(),
        method: "GET",
        params: { prefix: "__panthorium_healthcheck__/", maxResults: 1, fields: "items(name)" }
      });
      this.probeResult = { ok: true };
    } catch (error) {
      this.probeResult = { ok: false, reason: error.code || "files_storage_unavailable" };
    }
    this.probeAt = Date.now();
    return { ...this.probeResult };
  }

  async listAll(userId) {
    const prefix = this.ownerPrefix(userId);
    const files = [];
    let pageToken;
    for (let page = 0; page < 100; page += 1) {
      const params = { prefix, maxResults: 1000, fields: "items(name,size,timeCreated,updated,contentType),nextPageToken" };
      if (pageToken) params.pageToken = pageToken;
      const data = await this.request({ url: this.objectsUrl(), method: "GET", params });
      for (const item of (data && data.items) || []) {
        const file = this.normalizeObject(item, prefix);
        if (file) files.push(file);
      }
      if (files.length > this.maxUserFiles) throw new CloudFilesError(413, "files_count_limit");
      pageToken = data && data.nextPageToken;
      if (!pageToken) return files.sort((a, b) => String(b.updatedAt || "").localeCompare(String(a.updatedAt || "")));
    }
    throw new CloudFilesError(413, "files_count_limit");
  }

  async list(userId) {
    this.ensureConfigured();
    const files = await this.listAll(userId);
    const maxBytes=this.entitlements ? (await this.entitlements.state(userId)).remaining.storageBytes : MAX_USER_BYTES;
    return { ...folderListing(files), usedBytes: files.reduce((sum, file) => sum + file.size, 0), maxBytes, maxFiles: this.maxUserFiles };
  }

  async upload(userId, filename, contentType, body) {
    // Serialize actual storage mutations across instances; entitlement reads happen before locking.
    if(this.entitlements)return this.entitlements.locked(userId,async client=>{const state=await this.entitlements.stateIn(client,userId);return this.uploadWithLimit(userId,filename,contentType,body,state.remaining.storageBytes);});
    return this.uploadWithLimit(userId,filename,contentType,body,MAX_USER_BYTES);
  }
  async uploadWithLimit(userId, filename, contentType, body, maxBytes) {
    const prefix = this.ownerPrefix(userId);
    this.ensureConfigured();
    const bytes = Buffer.isBuffer(body) ? body : Buffer.from(body || []);
    if (!bytes.length) throw new CloudFilesError(400, "empty_file");
    if (bytes.length > MAX_FILE_BYTES) throw new CloudFilesError(413, "file_too_large");
    const existing = await this.listAll(userId);
    if (existing.length >= this.maxUserFiles) throw new CloudFilesError(413, "files_count_limit");
    const usedBytes = existing.reduce((sum, file) => sum + file.size, 0);
    if (usedBytes + bytes.length > maxBytes) throw new CloudFilesError(413, "files_quota_exceeded");
    const id = crypto.randomUUID();
    const name = sanitizeFilename(filename);
    const objectName = prefix + id + "/" + name;
    const url = "https://storage.googleapis.com/upload/storage/v1/b/" + encodeURIComponent(this.bucket) + "/o";
    await this.request({
      url,
      method: "POST",
      params: { uploadType: "media", name: objectName },
      headers: { "Content-Type": safeContentType(contentType) },
      data: bytes
    });
    return { id, name, contentType: safeContentType(contentType), folderId: folderFor({ name, contentType }), size: bytes.length, updatedAt: new Date().toISOString() };
  }

  async findObject(userId, fileId) {
    const ownerPrefix = this.ownerPrefix(userId);
    if (!FILE_ID_RE.test(String(fileId || ""))) throw new CloudFilesError(400, "invalid_file_id");
    const prefix = ownerPrefix + fileId + "/";
    const data = await this.request({
      url: this.objectsUrl(),
      method: "GET",
      params: { prefix, maxResults: 2, fields: "items(name,size,timeCreated,updated,contentType)" }
    });
    const file = ((data && data.items) || [])
      .map(item => this.normalizeObject(item, ownerPrefix))
      .find(item => item && item.id === fileId);
    if (!file) throw new CloudFilesError(404, "file_not_found");
    return file;
  }

  async download(userId, fileId) {
    const file = await this.findObject(userId, fileId);
    // Reject known over-quota downloads before fetching their cloud payload.
    // Actual transferred size is charged atomically after the fetch as before.
    if (this.entitlements) {
      const state = await this.entitlements.state(userId);
      const size = Number(file.size);
      if (!Number.isSafeInteger(size) || size < 0) throw new CloudFilesError(503, 'file_size_unavailable');
      if (size > Number(state.remaining?.downloadBytes || 0)) throw new CloudFilesError(402, 'quota_exceeded:downloadBytes');
    }
    const objectName = this.ownerPrefix(userId) + file.id + "/" + file.name;
    const data = await this.request({
      url: this.objectsUrl() + "/" + encodeURIComponent(objectName),
      method: "GET",
      params: { alt: "media" },
      responseType: "arraybuffer"
    });
    const body=Buffer.isBuffer(data) ? data : Buffer.from(data || []);
    if(this.entitlements)await this.entitlements.consume(userId,{downloadBytes:body.length});
    return { ...file, body };
  }

  async preview(userId, fileId) {
    // Viewing an owned file is separate from exporting it. Never accept an
    // object URL or another account's prefix from the client.
    const file = await this.findObject(userId, fileId);
    const extension = String(file.name).split('.').pop().toLowerCase();
    const types = { png:'image/png', jpg:'image/jpeg', jpeg:'image/jpeg', webp:'image/webp', gif:'image/gif',
      mp4:'video/mp4', webm:'video/webm', mp3:'audio/mpeg', wav:'audio/wav', ogg:'audio/ogg', m4a:'audio/mp4',
      html:'text/html', htm:'text/html', txt:'text/plain', md:'text/plain',
      csv:'text/plain', tsv:'text/plain', json:'text/plain', xml:'text/plain', yaml:'text/plain', yml:'text/plain',
      js:'text/plain', ts:'text/plain', py:'text/plain', css:'text/plain', sql:'text/plain' };
    const office = /^(docx|xlsx|pptx)$/.test(extension);
    const allowed = new Set(Object.values(types));
    const contentType = types[extension] || (allowed.has(file.contentType) ? file.contentType : null);
    if (!office && !contentType) throw new CloudFilesError(415, 'file_preview_unsupported');
    const size = Number(file.size);
    if (!Number.isSafeInteger(size) || size < 0 || size > MAX_FILE_BYTES) throw new CloudFilesError(413, 'file_preview_too_large');
    const objectName = this.ownerPrefix(userId) + file.id + '/' + file.name;
    const data = await this.request({ url: this.objectsUrl() + '/' + encodeURIComponent(objectName), method: 'GET',
      params: { alt: 'media' }, responseType: 'arraybuffer', maxContentLength: MAX_FILE_BYTES, timeout: 30000 });
    let body = Buffer.isBuffer(data) ? data : Buffer.from(data || []);
    if (body.length > MAX_FILE_BYTES) throw new CloudFilesError(413, 'file_preview_too_large');
    if (office) {
      try { body = Buffer.from(require('./officeArtifactService').extractOfficeText(body)); }
      catch (_) { throw new CloudFilesError(422, 'file_preview_invalid_office'); }
    }
    return { ...file, body, contentType: office ? 'text/plain' : contentType, previewFormat: office ? 'office-text' : 'original' };
  }

  async remove(userId, fileId) {
    const file = await this.findObject(userId, fileId);
    const objectName = this.ownerPrefix(userId) + file.id + "/" + file.name;
    await this.request({
      url: this.objectsUrl() + "/" + encodeURIComponent(objectName),
      method: "DELETE"
    });
    return { ok: true, fileId: file.id };
  }
}

module.exports = {
  CloudFilesService,
  CloudFilesError,
  MAX_FILE_BYTES,
  MAX_USER_BYTES,
  MAX_USER_FILES,
  sanitizeFilename
};
