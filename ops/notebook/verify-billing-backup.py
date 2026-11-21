"""Restore one notebook backup to a private disposable database and check billing."""
import argparse
import json
import sqlite3
import tempfile
import time
import uuid
from pathlib import Path

from runtime import BIN, STAGES, command, drop_probe, file_hash, ident, pg_env, read, sql


def verify(backup, stage):
    backup = Path(backup).resolve()
    manifest = read(backup / 'backup.json')
    if manifest['stage'] != stage:
        raise ValueError('backup_stage_mismatch')
    archive = backup / 'database.dump'
    objects = backup / 'objects.sqlite3'
    if file_hash(archive) != manifest['databaseSha256'] or file_hash(objects) != manifest['objectsSha256']:
        raise ValueError('backup_checksum_mismatch')

    with sqlite3.connect(objects.as_uri() + '?mode=ro&immutable=1', uri=True) as store:
        if store.execute('PRAGMA quick_check').fetchone()[0] != 'ok':
            raise ValueError('invalid_backup_object_store')
        object_count = store.execute('SELECT COUNT(*) FROM objects').fetchone()[0]
        pending = 0
        if store.execute("SELECT 1 FROM sqlite_master WHERE type='table' AND name='panthorium_http_audit_pending'").fetchone():
            pending = store.execute('SELECT COUNT(*) FROM panthorium_http_audit_pending').fetchone()[0]

    probe = 'panthorium_probe_' + stage + '_' + uuid.uuid4().hex[:8]
    started = time.monotonic()
    sql('CREATE DATABASE ' + ident(probe) + ' TEMPLATE template0 OWNER ' + ident(STAGES[stage]['role']))
    try:
        sql('REVOKE ALL ON DATABASE ' + ident(probe) + ' FROM PUBLIC')
        env = pg_env(stage, probe)
        with tempfile.TemporaryDirectory(prefix='panthorium-restore-') as tmp:
            command([BIN / 'pg_restore.exe', '--no-password', '--single-transaction', '--exit-on-error',
                     '--no-owner', '--no-privileges', '--dbname', probe, archive],
                    env=env, timeout=600, logfile=Path(tmp) / 'restore.log')
        # Return only counts. Historical transactions and account details stay on the host.
        result = json.loads(sql("""
        WITH orders AS (
          SELECT * FROM panthorium_checkout_live_orders WHERE provider='stripe'
        ), paid AS (
          SELECT * FROM orders WHERE status='paid'
        )
        SELECT json_build_object(
          'orders',(SELECT count(*) FROM orders),
          'paid',(SELECT count(*) FROM paid),
          'grantErrors',(SELECT count(*) FROM paid p WHERE NOT EXISTS (
            SELECT 1 FROM panthorium_entitlement_grants g WHERE g.order_id=p.id
              AND g.user_id=p.user_id AND g.product_id=p.product_id)),
          'incomeErrors',(SELECT count(*) FROM paid p WHERE COALESCE(p.collected_amount,p.amount)>0 AND (
            SELECT count(*)=1 AND COALESCE(sum(f.amount),0)=COALESCE(p.collected_amount,p.amount)
              FROM panthorium_finance_entries f WHERE f.order_id=p.id AND f.kind='income') IS NOT TRUE)
        )
        """, env=dict(env, PGOPTIONS='-c default_transaction_read_only=on')))
        if result['grantErrors'] or result['incomeErrors']:
            raise ValueError('restored_billing_mismatch ' + json.dumps(result))
        return dict(result, stage=stage, objects=object_count, pendingHttpEvents=pending,
                    backupTime=manifest['createdAt'], restoreSeconds=round(time.monotonic() - started, 1))
    finally:
        drop_probe(probe)


if __name__ == '__main__':
    args = argparse.ArgumentParser(description=__doc__)
    args.add_argument('backup', type=Path)
    args.add_argument('--stage', choices=STAGES, default='production')
    options = args.parse_args()
    print(json.dumps(verify(options.backup, options.stage)))
