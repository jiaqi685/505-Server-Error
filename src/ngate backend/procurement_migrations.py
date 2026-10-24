"""Forward-only, additive schema. Existing catalogue and legacy tables are untouched."""
import sqlite3
from datetime import datetime, timezone
from pathlib import Path

SCHEMA = """
BEGIN IMMEDIATE;
CREATE TABLE IF NOT EXISTS v5_migrations(version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS v5_rfqs(
 id TEXT PRIMARY KEY, owner_id TEXT NOT NULL, product_id TEXT NOT NULL REFERENCES products(id),
 payload TEXT NOT NULL, created_at TEXT NOT NULL, UNIQUE(owner_id,id));
CREATE INDEX IF NOT EXISTS v5_rfqs_owner ON v5_rfqs(owner_id,product_id,created_at);
CREATE TABLE IF NOT EXISTS v5_quotes(
 id TEXT PRIMARY KEY, owner_id TEXT NOT NULL, rfq_id TEXT NOT NULL, supplier_id TEXT NOT NULL REFERENCES suppliers(id),
 payload TEXT NOT NULL, UNIQUE(owner_id,id), UNIQUE(owner_id,rfq_id,supplier_id),
 FOREIGN KEY(owner_id,rfq_id) REFERENCES v5_rfqs(owner_id,id));
CREATE TABLE IF NOT EXISTS v5_purchase_orders(
 id TEXT PRIMARY KEY, owner_id TEXT NOT NULL, product_id TEXT NOT NULL REFERENCES products(id),
 rfq_id TEXT, quote_id TEXT, status TEXT NOT NULL CHECK(status IN ('draft','approved')),
 dedup_key TEXT NOT NULL, payload TEXT NOT NULL, UNIQUE(owner_id,id), UNIQUE(owner_id,dedup_key),
 FOREIGN KEY(owner_id,rfq_id) REFERENCES v5_rfqs(owner_id,id),
 FOREIGN KEY(owner_id,quote_id) REFERENCES v5_quotes(owner_id,id));
CREATE TABLE IF NOT EXISTS v5_activity(
 id TEXT PRIMARY KEY, owner_id TEXT NOT NULL, created_at TEXT NOT NULL, payload TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS v5_activity_owner ON v5_activity(owner_id,created_at);
CREATE TABLE IF NOT EXISTS v5_idempotency(
 owner_id TEXT NOT NULL, operation TEXT NOT NULL, request_key TEXT NOT NULL,
 input_hash TEXT NOT NULL, response TEXT NOT NULL,
 PRIMARY KEY(owner_id,operation,request_key));
INSERT OR IGNORE INTO v5_migrations VALUES(1,strftime('%Y-%m-%dT%H:%M:%fZ','now'));
COMMIT;
"""

MULTI_PRODUCT_QUOTATIONS = """
BEGIN IMMEDIATE;
CREATE TABLE IF NOT EXISTS v5_quotation_documents(
 owner_id TEXT NOT NULL, id TEXT NOT NULL, fingerprint TEXT NOT NULL,
 payload TEXT NOT NULL, created_at TEXT NOT NULL,
 PRIMARY KEY(owner_id,id), UNIQUE(owner_id,fingerprint));
CREATE INDEX IF NOT EXISTS v5_quotation_documents_owner ON v5_quotation_documents(owner_id,created_at);
CREATE TABLE IF NOT EXISTS v5_price_references(
 id TEXT PRIMARY KEY, owner_id TEXT NOT NULL, document_id TEXT NOT NULL,
 line_item_id TEXT NOT NULL, product_id TEXT REFERENCES products(id),
 supplier_id TEXT REFERENCES suppliers(id), status TEXT NOT NULL CHECK(status IN ('pending','verified','linked')),
 payload TEXT NOT NULL, created_at TEXT NOT NULL, UNIQUE(owner_id,id),
 UNIQUE(owner_id,document_id,line_item_id),
 FOREIGN KEY(owner_id,document_id) REFERENCES v5_quotation_documents(owner_id,id));
CREATE INDEX IF NOT EXISTS v5_price_references_owner_product ON v5_price_references(owner_id,product_id,status);
INSERT OR IGNORE INTO v5_migrations VALUES(2,strftime('%Y-%m-%dT%H:%M:%fZ','now'));
COMMIT;
"""


def backup_database(db, database_path, label):
    path = Path(database_path)
    folder = path.parent / 'backups'
    folder.mkdir(parents=True, exist_ok=True)
    backup = folder / (label + '-' + datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%S%fZ') + '.sqlite3')
    destination = sqlite3.connect(backup)
    try:
        db.backup(destination)
        if destination.execute('PRAGMA integrity_check').fetchone()[0] != 'ok':
            raise RuntimeError('Procurement migration backup failed integrity check.')
    finally:
        destination.close()
    return backup


def migrate_procurement(db, database_path):
    exists = db.execute("SELECT 1 FROM sqlite_master WHERE name='v5_migrations'").fetchone()
    if not exists or not db.execute('SELECT 1 FROM v5_migrations WHERE version=1').fetchone():
        backup_database(db, database_path, 'before-owner-procurement')
        db.executescript(SCHEMA)
    if not db.execute('SELECT 1 FROM v5_migrations WHERE version=2').fetchone():
        backup_database(db, database_path, 'before-multi-product-quotation')
        db.executescript(MULTI_PRODUCT_QUOTATIONS)
