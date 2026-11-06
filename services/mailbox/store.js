'use strict';
const {randomUUID,randomBytes,createCipheriv,createDecipheriv}=require('node:crypto');
const fail=(code,status=400)=>{throw Object.assign(new Error(code),{status});};
function owner(user){const id=String(user?.sub||user?.id||'');if(!id||id.startsWith('guest:')||user?.roles?.includes('guest'))fail('mailbox_account_required',403);return id;}
class MailboxStore {
 constructor({pool,key}){this.pool=pool;this.key=Buffer.from(key||'','base64');this.ready=null;}
 seal(data,aad){if(this.key.length!==32)fail('mailbox_encryption_not_configured',503);const iv=randomBytes(12),c=createCipheriv('aes-256-gcm',this.key,iv);c.setAAD(Buffer.from(aad));return Buffer.concat([iv,c.update(JSON.stringify(data)),c.final(),c.getAuthTag()]).toString('base64');}
 open(data,aad){const b=Buffer.from(data,'base64'),c=createDecipheriv('aes-256-gcm',this.key,b.subarray(0,12));c.setAAD(Buffer.from(aad));c.setAuthTag(b.subarray(-16));return JSON.parse(Buffer.concat([c.update(b.subarray(12,-16)),c.final()]).toString());}
 async init(){if(!this.pool)fail('mailbox_database_required',503);if(!this.ready)this.ready=this.pool.query(`CREATE TABLE IF NOT EXISTS panthorium_user_mailbox (id TEXT PRIMARY KEY,user_id TEXT NOT NULL,kind TEXT NOT NULL,state TEXT NOT NULL,data TEXT NOT NULL,expires_at BIGINT NOT NULL);CREATE INDEX IF NOT EXISTS user_mailbox_owner_kind ON panthorium_user_mailbox(user_id,kind);`).catch(e=>{this.ready=null;throw e;});await this.ready;}
 async put(user,kind,data,{id=randomUUID(),state='ready',ttl=86400000}={}){await this.init();const uid=owner(user);await this.pool.query('INSERT INTO panthorium_user_mailbox(id,user_id,kind,state,data,expires_at) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(id) DO UPDATE SET data=EXCLUDED.data,state=EXCLUDED.state,expires_at=EXCLUDED.expires_at WHERE panthorium_user_mailbox.user_id=EXCLUDED.user_id AND panthorium_user_mailbox.kind=EXCLUDED.kind',[id,uid,kind,state,this.seal(data,uid+':'+kind+':'+id),Date.now()+ttl]);return id;}
 async get(user,kind,id){await this.init();const uid=owner(user),r=(await this.pool.query('SELECT * FROM panthorium_user_mailbox WHERE id=$1 AND user_id=$2 AND kind=$3',[id,uid,kind])).rows[0];if(!r||Number(r.expires_at)<Date.now())fail('mailbox_record_not_found',404);return {...this.open(r.data,uid+':'+kind+':'+id),id:r.id,state:r.state};}
 async list(user,kind){await this.init();const uid=owner(user);const rows=(await this.pool.query('SELECT * FROM panthorium_user_mailbox WHERE user_id=$1 AND kind=$2 AND expires_at>$3',[uid,kind,Date.now()])).rows;return rows.map(r=>({...this.open(r.data,uid+':'+kind+':'+r.id),id:r.id,state:r.state}));}
 async claim(user,kind,id){await this.init();const r=await this.pool.query("UPDATE panthorium_user_mailbox SET state='executing' WHERE id=$1 AND user_id=$2 AND kind=$3 AND state='ready' AND expires_at>$4 RETURNING id",[id,owner(user),kind,Date.now()]);if(!r.rows.length)fail('mailbox_action_already_used_or_expired',409);}
 async remove(user,kind,id){await this.init();await this.pool.query('DELETE FROM panthorium_user_mailbox WHERE user_id=$1 AND kind=$2 AND id=$3',[owner(user),kind,id]);}
 async purge(user){await this.init();await this.pool.query('DELETE FROM panthorium_user_mailbox WHERE user_id=$1',[owner(user)]);}
 async cleanup(){await this.init();await this.pool.query('DELETE FROM panthorium_user_mailbox WHERE expires_at<$1',[Date.now()]);}
}
module.exports={MailboxStore,owner,fail};
