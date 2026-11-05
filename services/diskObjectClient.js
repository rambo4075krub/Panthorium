'use strict';

const { DatabaseSync } = require('node:sqlite');
const { createHash, randomUUID } = require('node:crypto');
const path = require('node:path');

// Private transport for the files and notes repositories on the notebook.
// Object names remain data, including names Windows cannot represent as paths.
class DiskObjectClient {
  constructor(root, bucket) {
    if (!path.isAbsolute(root) || !bucket) throw new Error('invalid_disk_store');
    this.bucket = bucket;
    this.db = new DatabaseSync(path.join(root, 'objects.sqlite3'), { readOnly: false });
    this.db.exec('PRAGMA busy_timeout=10000; PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL;');
    this.db.prepare('SELECT name, body FROM objects LIMIT 0').all();
  }

  async request({url, method, params = {}, data, headers = {}}) {
    const parsed = new URL(url);
    const listPath = '/storage/v1/b/' + encodeURIComponent(this.bucket) + '/o';
    if (parsed.origin !== 'https://storage.googleapis.com') throw new Error('unexpected_object_endpoint');
    if (method === 'GET' && parsed.pathname === listPath) {
      const prefix = String(params.prefix || '');
      const limit = Math.min(1000, Math.max(1, Number(params.maxResults) || 1000));
      const rows = this.db.prepare(
        'SELECT name, content_type AS contentType, length(body) AS size, created AS timeCreated, updated FROM objects ' +
        'WHERE substr(name,1,length(?))=? AND name>? ORDER BY name COLLATE BINARY LIMIT ?'
      ).all(prefix, prefix, params.pageToken || '', limit + 1);
      const items = rows.slice(0, limit);
      return {data: {items, nextPageToken: rows.length > limit ? items[items.length-1].name : undefined}};
    }
    if (method === 'POST' && parsed.pathname === '/upload' + listPath && params.uploadType === 'media') {
      const name = String(params.name || '');
      const body = Buffer.from(data);
      const now = new Date().toISOString();
      const generation = 'local:' + randomUUID();
      const hash = createHash('sha256').update(body).digest('hex');
      this.db.prepare('INSERT INTO objects(name,content_type,created,updated,generation,sha256,metadata,body) VALUES(?,?,?,?,?,?,?,?) ' +
        'ON CONFLICT(name) DO UPDATE SET content_type=excluded.content_type, updated=excluded.updated, generation=excluded.generation, sha256=excluded.sha256, metadata=excluded.metadata, body=excluded.body'
      ).run(name, headers['Content-Type'] || 'application/octet-stream', now, now, generation, hash, '{}', body);
      return {data:{name, generation}};
    }
    if (parsed.pathname.startsWith(listPath + '/')) {
      const name = decodeURIComponent(parsed.pathname.slice(listPath.length + 1));
      if (method === 'GET' && params.alt === 'media') {
        const found = this.db.prepare('SELECT body FROM objects WHERE name=?').get(name);
        if (found) return {data:Buffer.from(found.body)};
      } else if (method === 'DELETE') {
        if (this.db.prepare('DELETE FROM objects WHERE name=?').run(name).changes) return {data:{}};
      } else throw new Error('unsupported_object_operation');
      const error = new Error('object_not_found');
      error.response = {status:404};
      throw error;
    }
    throw new Error('unsupported_object_operation');
  }
}

module.exports = { DiskObjectClient };
