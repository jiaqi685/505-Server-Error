"""Verified demo supplier names shared with React; historical payloads are never rewritten."""
import json
import math
import re
import unicodedata
from pathlib import Path

MASTER = json.loads((Path(__file__).resolve().parents[2] / 'lib' / 'supplier-master.json').read_text())
DOCUMENT_EVIDENCE = json.loads((Path(__file__).resolve().parents[2] / 'lib' / 'supplier-document-evidence.json').read_text())


def active_documented_supplier(product_id, supplier_id):
    active = any(s['supplierId'] == supplier_id and s.get('active') is not False for s in MASTER)
    return active and any(d['supplierId'] == supplier_id and
                          product_id in DOCUMENT_EVIDENCE['groups'][d['group']]
                          for d in DOCUMENT_EVIDENCE['documents'])


def master_supplier(supplier_id):
    return next((supplier for supplier in MASTER if supplier['supplierId'] == supplier_id), None)


def requires_pack_multiplier(quoted_unit, stock_unit):
    outer = {'carton', 'case', 'box', 'crate', 'tray', 'pack', 'bundle'}
    individual = {'bottle', 'can', 'tin', 'piece', 'unit', 'each', 'item', 'bar'}
    return normalized_unit(quoted_unit or '') in outer and normalized_unit(stock_unit or '') in individual


def register_master_supplier(db, supplier_id):
    """Register only a pre-verified master entry after an owner confirms its document identity."""
    master = master_supplier(supplier_id)
    if master is None:
        return None
    existing = db.execute('SELECT id,name FROM suppliers WHERE id=?', (supplier_id,)).fetchone()
    if existing:
        return existing
    db.execute('INSERT INTO suppliers (id,name) VALUES (?,?)',
               (supplier_id, master['supplierName']))
    return {'id': supplier_id, 'name': master['supplierName']}


def normalized_unit(unit):
    if not isinstance(unit, str):
        return ''
    token = re.sub(r'[^a-z0-9]+', '', unit.strip().lower())
    aliases = {
        'ctn': 'carton', 'ctns': 'carton',
        'btl': 'bottle', 'btls': 'bottle',
        'pc': 'piece', 'pcs': 'piece',
        'ea': 'each',
    }
    return aliases.get(token, token.removesuffix('s'))


def valid_pack_conversion(evidence, quoted_unit, stock_unit, original_price, normalized_price):
    """Validate server-persisted conversion metadata before it authorizes a quote."""
    if not isinstance(evidence, dict):
        return False
    try:
        multiplier = evidence.get('unitsPerOuter')
        inner_size = float(evidence.get('innerSizeMl'))
        source_price = float(evidence.get('originalUnitPrice'))
        normalized = float(evidence.get('normalizedUnitPrice'))
        if type(multiplier) is not int or multiplier <= 1:
            return False
        if not evidence.get('sourceText') or inner_size <= 0 or source_price <= 0 or normalized <= 0:
            return False
        if evidence.get('cataloguePackStatus') not in ('catalogue-match', 'owner-confirmed'):
            return False
        if normalized_unit(evidence.get('outerUnit')) != normalized_unit(quoted_unit):
            return False
        if normalized_unit(evidence.get('innerUnit')) != normalized_unit(stock_unit):
            return False
        return (
            math.isclose(source_price, float(original_price), rel_tol=1e-9, abs_tol=1e-9)
            and math.isclose(normalized, float(normalized_price), rel_tol=1e-9, abs_tol=1e-9)
            and math.isclose(normalized * multiplier, source_price, rel_tol=1e-9, abs_tol=1e-9)
        )
    except (TypeError, ValueError):
        return False


def owner_verified_supplier_relationship(db, owner_id, product_id, supplier_id):
    """A reviewed line activates only its exact supplier/product pair for its owner."""
    if not owner_id or not product_id or not supplier_id or not master_supplier(supplier_id):
        return False
    product_row = db.execute('SELECT unit FROM products WHERE id=?', (product_id,)).fetchone()
    if not product_row:
        return False
    rows = db.execute('''SELECT r.status,r.product_id,r.supplier_id,r.payload,d.payload AS document_payload
        FROM v5_price_references r JOIN v5_quotation_documents d
          ON d.owner_id=r.owner_id AND d.id=r.document_id
        WHERE r.owner_id=? AND r.product_id=? AND r.supplier_id=? AND r.status IN ('verified','linked')''',
        (owner_id, product_id, supplier_id)).fetchall()
    master = master_supplier(supplier_id)
    for row in rows:
        line = json.loads(row['payload'])
        document = json.loads(row['document_payload'])
        if not (line.get('productMatchConfirmed') is True and line.get('packUomConfirmed') is True
                and line.get('priceConfirmed') is True and line.get('unitPrice') is not None
                and line.get('unitPrice') > 0):
            continue
        document_supplier = document.get('quotedSupplierName')
        identity_matches = bool(document_supplier and supplier_identity(document_supplier)
                                and supplier_identity(document_supplier) == supplier_identity(master['supplierName']))
        document_confirmed = (
            document.get('supplierIdentityConfirmed') is True
            and document.get('confirmedSupplierId') == supplier_id
            and (identity_matches or document.get('supplierOverrideConfirmed') is True)
        )
        legacy_line_confirmed = (
            line.get('supplierIdentityConfirmed') is True
            and (not document_supplier or identity_matches or line.get('supplierOverrideConfirmed') is True)
        )
        if not (document_confirmed or legacy_line_confirmed):
            continue
        quoted_unit = line.get('unit')
        unit_matches = normalized_unit(quoted_unit) == normalized_unit(product_row['unit'])
        explicit_one_to_one = (
            line.get('unitConversionConfirmed') is True
            and isinstance(line.get('unitConversionNote'), str)
            and bool(line['unitConversionNote'].strip())
            and not requires_pack_multiplier(quoted_unit, product_row['unit'])
        )
        pack_conversion = line.get('packConversionEvidence')
        converted = valid_pack_conversion(
            pack_conversion, quoted_unit, product_row['unit'],
            line.get('unitPrice'), pack_conversion.get('normalizedUnitPrice') if isinstance(pack_conversion, dict) else None,
        ) if requires_pack_multiplier(quoted_unit, product_row['unit']) else False
        if unit_matches or explicit_one_to_one or converted:
            return True
    return False


def compatible_quote(quote, stock_unit):
    unit_matches = normalized_unit(quote.get('quotedUnit')) == normalized_unit(stock_unit)
    explicit_one_to_one = (
        quote.get('unitConversionConfirmed') is True
        and isinstance(quote.get('unitConversionNote'), str)
        and bool(quote['unitConversionNote'].strip())
        and not requires_pack_multiplier(quote.get('quotedUnit'), stock_unit)
    )
    pack_conversion = quote.get('packConversionEvidence')
    converted = valid_pack_conversion(
        pack_conversion, quote.get('quotedUnit'), stock_unit,
        quote.get('unitPrice'), quote.get('normalizedUnitPrice'),
    ) if requires_pack_multiplier(quote.get('quotedUnit'), stock_unit) else False
    return (quote.get('reviewConfirmed') is True and quote.get('packUomConfirmed') is True and
            bool(quote.get('quotedUnit')) and (unit_matches or explicit_one_to_one or converted) and
            (active_documented_supplier(quote['productId'], quote['supplierId']) or
             quote.get('supplierProductRelationshipConfirmed') is True))


def supplier_identity(name):
    compact = ''.join(c for c in unicodedata.normalize('NFKC', name).lower() if c.isalnum())
    return re.sub(r'sdnbhd$', '', compact)


def sync_verified_supplier_names(db):
    """Update only generic master labels, never custom company names or procurement history."""
    with db:
        for supplier in MASTER:
            if supplier['verified'] and supplier.get('active') is not False:
                db.execute('UPDATE suppliers SET name=? WHERE id=? AND name=?',
                           (supplier['supplierName'], supplier['supplierId'], supplier['legacyName']))
