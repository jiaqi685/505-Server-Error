"""Owner-scoped procurement using the existing SQLite connection and catalogue."""
import hashlib
import json
import math
import re
import uuid
from datetime import date, datetime, timezone
from decimal import Decimal, InvalidOperation
from zoneinfo import ZoneInfo
from flask import Blueprint, g, jsonify, request
from supplier_master import (
    supplier_identity, active_documented_supplier, compatible_quote, master_supplier,
    normalized_unit, owner_verified_supplier_relationship, register_master_supplier,
    requires_pack_multiplier, valid_pack_conversion,
)

bp = Blueprint('procurement_v2', __name__)
READS = {'dashboard', 'latest-rfq', 'quotes', 'orders', 'activity', 'quotation-documents', 'price-references'}
WRITES = {'create-rfq', 'whatsapp-opened', 'mark-sent', 'save-quote', 'example-quotes', 'create-po', 'approve-po', 'mark-po-sent', 'log-activity',
          'import-quotation-document', 'confirm-quotation-supplier', 'review-price-reference', 'verify-price-references', 'link-price-reference'}
TABLES = {'v5_rfqs', 'v5_quotes', 'v5_purchase_orders', 'v5_activity'}
EVIDENCE = {'leadTimeBasis', 'leadTimeText', 'quotedSupplierName', 'quotedProductName', 'quotedUnit', 'packDescription', 'confidence', 'needsHumanReview', 'reviewConfirmed', 'packUomConfirmed', 'supplierOverrideConfirmed', 'deliveryDateConfirmed', 'deliveryConfirmationSource', 'deliveryConfirmationNote', 'documentQuotedDeliveryDate', 'unitConversionConfirmed', 'unitConversionNote'}


class ProcurementError(Exception):
    def __init__(self, message, status=400):
        self.message, self.status = message, status


@bp.errorhandler(ProcurementError)
def procurement_error(exc):
    return jsonify(error=exc.message), exc.status


def require(condition, message, status=400):
    if not condition:
        raise ProcurementError(message, status)


def stamp():
    return datetime.now(timezone.utc).isoformat()


def new_id(prefix):
    return prefix + '-' + uuid.uuid4().hex[:20]


def encoded(value):
    return json.dumps(value, sort_keys=True, separators=(',', ':'), allow_nan=False)


def fields(data, allowed):
    require(isinstance(data, dict) and not (set(data) - set(allowed)), 'Invalid or unsupported request fields.')


def integer(value, label, zero=False):
    require(type(value) is int and (0 if zero else 1) <= value <= 1_000_000, label + ' must be a valid whole number.')
    return value


def money(value):
    require(type(value) in (int, float), 'Unit price must be numeric RM.')
    try:
        result = Decimal(str(value))
        require(result.is_finite() and 0 < result <= 1_000_000 and result == result.quantize(Decimal('.01')), 'Unit price must be positive RM with at most two decimal places.')
        return result
    except InvalidOperation:
        raise ProcurementError('Invalid monetary amount.')


def precise_unit_price(value):
    """Keep normalized stock-unit prices precise when outer-pack prices do not divide evenly."""
    require(type(value) in (int, float), 'Unit price must be numeric RM.')
    try:
        result = Decimal(str(value))
        require(result.is_finite() and 0 < result <= 1_000_000, 'Unit price must be positive RM.')
        return result
    except InvalidOperation:
        raise ProcurementError('Invalid monetary amount.')


def day(value, nullable=False):
    if value is None and nullable:
        return None
    require(isinstance(value, str) and re.fullmatch(r'\d{4}-\d{2}-\d{2}', value), 'Use a valid YYYY-MM-DD date.')
    try:
        parsed = date.fromisoformat(value)
    except ValueError:
        raise ProcurementError('Invalid calendar date.')
    require(parsed >= datetime.now(ZoneInfo('Asia/Kuala_Lumpur')).date(), 'Delivery date cannot be in the past.')
    return value


def product(pid):
    require(isinstance(pid, str), 'Product ID is required.')
    row = g.db.execute('SELECT * FROM products WHERE id=?', (pid,)).fetchone()
    require(row is not None, 'Unknown product.')
    return row


def quotation_product_issue(line, catalogue_product):
    """Reject explicit quote/catalogue conflicts without inventing catalogue metadata."""
    line_text = ' '.join(str(line.get(key) or '') for key in ('description', 'sku', 'packSpecification')).lower()
    product_text = ' '.join(str(catalogue_product[key] or '') for key in ('name', 'short_name')).lower()

    quoted_sku = re.sub(r'[^a-z0-9]+', '', str(line.get('sku') or '').lower())
    if quoted_sku:
        catalogue_codes = [catalogue_product['id']]
        if 'sku' in catalogue_product.keys() and catalogue_product['sku']:
            catalogue_codes.append(catalogue_product['sku'])
        known_codes = {re.sub(r'[^a-z0-9]+', '', str(code).lower()) for code in catalogue_codes}
        if quoted_sku not in known_codes:
            return 'The printed SKU is not recorded for this catalogue product. Keep the line pending until its exact SKU is verified.'

    def milk_flavour(value):
        if re.search(r'\b(strawber\w*|strawbeerry|susu strawberi)\b', value):
            return 'strawberry'
        if re.search(r'\b(chocolate|coklat)\b', value):
            return 'chocolate'
        if re.search(r'\b(original|plain)\b', value):
            return 'original'
        return None

    requested_flavour = milk_flavour(line_text)
    product_flavour = milk_flavour(product_text)
    if requested_flavour and requested_flavour != product_flavour:
        return 'The printed milk flavour conflicts with the selected catalogue product. Keep the line pending.'

    powder_detergent = re.search(
        r'\b(laundry\s+)?detergent\s+(powder|powdered)\b|\b(powder|powdered)\s+(laundry\s+)?detergent\b',
        line_text,
    )
    if powder_detergent and catalogue_product['id'] == 'laundry-detergent' \
            and normalized_unit(catalogue_product['unit']) == 'bottle':
        return 'The quotation is for detergent powder, while the catalogue item is a bottle. Keep it as a pending catalogue item.'

    def measures(value):
        found = set()
        for amount_text, unit in re.findall(r'(\d+(?:\.\d+)?)\s*(ml|cl|l|mg|kg|g)\b', value):
            amount = float(amount_text)
            base = amount * 1000 if unit == 'l' else amount * 10 if unit == 'cl' \
                else amount * 1000 if unit == 'kg' else amount / 1000 if unit == 'mg' else amount
            family = 'volume-ml' if unit in ('ml', 'cl', 'l') else 'mass-g'
            found.add((family, round(base, 6)))
        return found

    def pack_counts(value):
        return {
            int(count) for count in re.findall(
                r'\b(\d+)\s*[-]?\s*(?:x|×|pcs?|pieces?|packets?|packs?|bottles?|cartons?|cans?|sachets?|units?)\b',
                value,
            )
        }

    quote_pack = ' '.join(str(line.get(key) or '') for key in ('description', 'packSpecification')).lower()
    catalogue_pack = ' '.join(str(catalogue_product[key] or '') for key in ('pack_size', 'name')).lower()
    quote_measures, catalogue_measures = measures(quote_pack), measures(catalogue_pack)
    outer_pack_conversion = requires_pack_multiplier(line.get('unit'), catalogue_product['unit'])
    if (quote_measures or catalogue_measures) and not outer_pack_conversion:
        if not quote_measures or not catalogue_measures or not quote_measures.intersection(catalogue_measures):
            return 'The quoted pack size is not verified against a compatible catalogue pack specification. Keep the line pending.'
    quote_counts, catalogue_counts = pack_counts(quote_pack), pack_counts(catalogue_pack)
    if (quote_counts or catalogue_counts) and not outer_pack_conversion:
        if not quote_counts or not catalogue_counts or not quote_counts.intersection(catalogue_counts):
            return 'The quoted pack count is not verified against a compatible catalogue pack specification. Keep the line pending.'
    return None


def _volume_values(text):
    values = set()
    for amount_text, unit in re.findall(
        r'(\d+(?:\.\d+)?)\s*(ml|millilit(?:er|re)s?|l|lit(?:er|re)s?)\b',
        text.lower(),
    ):
        amount = float(amount_text)
        values.add(round(amount * 1000 if unit.startswith('l') else amount, 6))
    return values


def _pack_conversion_candidates(text):
    if re.search(r'\b(?:or|and)\b.{0,8}[x×]?\s*\d+', text, re.I):
        return []
    inner = r'(bottles?|btls?|cans?|tins?|pieces?|pcs?|units?|each|items?|bars?)'
    outer = r'(cartons?|ctns?|cases?|boxes?|crates?|trays?|packs?|bundles?)'
    patterns = [
        (re.compile(
            rf'\b(\d+(?:\.\d+)?)\s*(ml|millilit(?:er|re)s?|l|lit(?:er|re)s?)\s*[x×]\s*(\d+)(?:\s*{inner}\b)?(?:\s*per\s*{outer}\b)?',
            re.I,
        ), 'size-first'),
        (re.compile(
            rf'\b(\d+)\s*[x×]\s*(\d+(?:\.\d+)?)\s*(ml|millilit(?:er|re)s?|l|lit(?:er|re)s?)(?:\s*{inner}\b)?(?:\s*per\s*{outer}\b)?',
            re.I,
        ), 'count-first'),
        (re.compile(rf'\b(\d+)\s*{inner}\s*(?:per|/)\s*{outer}\b', re.I), 'ratio'),
        (re.compile(rf'\b1\s*{outer}\s*=\s*(\d+)\s*{inner}\b', re.I), 'equation'),
    ]
    candidates = []
    for pattern, kind in patterns:
        for match in pattern.finditer(text):
            if kind == 'size-first':
                amount, unit, count, inner_unit, outer_unit = match.groups()
            elif kind == 'count-first':
                count, amount, unit, inner_unit, outer_unit = match.groups()
            elif kind == 'ratio':
                count, inner_unit, outer_unit = match.groups()
                amount = unit = None
            else:
                outer_unit, count, inner_unit = match.groups()
                amount = unit = None
            if kind == 'equation':
                outer_unit = match.group(1)
                count = match.group(2)
                inner_unit = match.group(3)
            multiplier = int(count)
            if multiplier <= 1:
                continue
            size_ml = None
            if amount is not None:
                size_ml = float(amount) * (1000 if unit.lower().startswith('l') else 1)
            candidates.append({
                'count': multiplier,
                'inner': normalized_unit(inner_unit or ''),
                'outer': normalized_unit(outer_unit or ''),
                'sizeMl': round(size_ml, 6) if size_ml is not None else None,
                'sourceText': match.group(0),
            })
    return candidates


def verified_pack_conversion(line, catalogue_product, catalogue_confirmed):
    """Recompute an outer-pack conversion from source text; never accept a client multiplier."""
    text = ' '.join(str(line.get(key) or '') for key in ('description', 'packSpecification'))
    candidates = _pack_conversion_candidates(text)
    if not candidates:
        return None, 'The quotation does not state one unambiguous pack multiplier.'
    counts = {candidate['count'] for candidate in candidates}
    explicit_inner = {candidate['inner'] for candidate in candidates if candidate['inner']}
    explicit_outer = {candidate['outer'] for candidate in candidates if candidate['outer']}
    sizes = {candidate['sizeMl'] for candidate in candidates if candidate['sizeMl'] is not None}
    all_sizes = _volume_values(text)
    if len(counts) != 1 or len(explicit_inner) > 1 or len(explicit_outer) > 1 \
            or len(sizes) > 1 or len(all_sizes) > 1:
        return None, 'The printed pack multiplier or bottle size is ambiguous.'

    quoted_outer = normalized_unit(line.get('unit') or '')
    parsed_outer = next(iter(explicit_outer), quoted_outer)
    if parsed_outer != quoted_outer:
        return None, 'The printed outer pack unit conflicts with the quotation line unit.'
    stock_unit = normalized_unit(catalogue_product['unit'])
    parsed_inner = next(iter(explicit_inner), stock_unit)
    if parsed_inner != stock_unit:
        return None, 'The printed inner unit differs from the catalogue stock unit.'

    size_ml = next(iter(sizes), next(iter(all_sizes), None))
    if size_ml is None or size_ml <= 0:
        return None, 'The quotation does not state the inner bottle size needed to verify this SKU.'
    catalogue_text = ' '.join(str(catalogue_product[key] or '') for key in ('pack_size', 'name', 'short_name'))
    catalogue_sizes = _volume_values(catalogue_text)
    if len(catalogue_sizes) > 1:
        return None, 'The catalogue contains multiple possible bottle sizes; keep the quotation pending.'
    if catalogue_sizes and abs(next(iter(catalogue_sizes)) - size_ml) > 0.000001:
        return None, 'The quoted bottle size conflicts with the catalogue specification.'
    catalogue_status = 'catalogue-match' if catalogue_sizes else 'owner-confirmed'
    if not catalogue_sizes and catalogue_confirmed is not True:
        return None, 'The catalogue bottle size is not stated. Confirm that this quoted size matches the exact stocked item.'

    multiplier = next(iter(counts))
    original_price = float(line['unitPrice'])
    normalized_price = original_price / multiplier
    quoted_quantity = line.get('quotedQuantity')
    equivalent_quantity = None
    if type(quoted_quantity) in (int, float) and quoted_quantity > 0:
        equivalent_quantity = quoted_quantity * multiplier
        if isinstance(equivalent_quantity, float) and equivalent_quantity.is_integer():
            equivalent_quantity = int(equivalent_quantity)
    evidence_source = max(candidates, key=lambda candidate: (
        candidate['sizeMl'] is not None,
        bool(candidate['inner']),
        bool(candidate['outer']),
    ))
    return {
        'sourceText': evidence_source['sourceText'][:500],
        'outerUnit': quoted_outer,
        'innerUnit': stock_unit,
        'unitsPerOuter': multiplier,
        'innerSizeMl': float(size_ml),
        'originalUnitPrice': original_price,
        'normalizedUnitPrice': normalized_price,
        'quotedQuantity': quoted_quantity,
        'equivalentQuantity': equivalent_quantity,
        'originalLineTotal': line.get('lineTotal'),
        'cataloguePackStatus': catalogue_status,
        'cataloguePackDescription': catalogue_product['pack_size'] or None,
        'reviewedAt': stamp(),
    }, None


def supplier_is_eligible(pid, sid, owner_id=None):
    owner_id = owner_id or getattr(g, 'ngate_owner', None)
    existing_pair = g.db.execute('SELECT 1 FROM supplier_products WHERE product_id=? AND supplier_id=?',
                                 (pid, sid)).fetchone()
    return bool(existing_pair and active_documented_supplier(pid, sid)) or owner_verified_supplier_relationship(
        g.db, owner_id, pid, sid
    )


def supplier(pid, sid):
    require(isinstance(sid, str), 'Supplier ID is required.')
    row = g.db.execute('SELECT s.id,s.name,sp.lead_days FROM suppliers s JOIN supplier_products sp ON sp.supplier_id=s.id WHERE sp.product_id=? AND s.id=?', (pid, sid)).fetchone()
    require(supplier_is_eligible(pid, sid), 'Supplier/product relationship needs an explicitly reviewed quotation line.')
    if row and active_documented_supplier(pid, sid):
        return row
    master = master_supplier(sid)
    require(master is not None, 'Unknown supplier ID.')
    return {'id': sid, 'name': master['supplierName'], 'lead_days': None}


def owned(table, record_id):
    assert table in TABLES
    row = g.db.execute(f'SELECT payload FROM {table} WHERE owner_id=? AND id=?', (g.ngate_owner, record_id)).fetchone()
    require(row is not None, 'Record not found in your account.', 404)
    return json.loads(row['payload'])


def listing(table):
    assert table in TABLES
    return [json.loads(row['payload']) for row in g.db.execute(f'SELECT payload FROM {table} WHERE owner_id=? ORDER BY rowid DESC', (g.ngate_owner,))]


def quote_public(quote):
    public = dict(quote)
    public['supplierProductRelationshipConfirmed'] = supplier_is_eligible(
        public.get('productId'), public.get('supplierId')
    )
    return public


def document_supplier_state(document_id, document):
    confirmed_id = document.get('confirmedSupplierId')
    if confirmed_id and document.get('supplierIdentityConfirmed') is True:
        return {
            'confirmedSupplierId': confirmed_id,
            'supplierIdentityConfirmed': True,
            'supplierOverrideConfirmed': document.get('supplierOverrideConfirmed') is True,
            'supplierConfirmedAt': document.get('supplierConfirmedAt'),
        }

    # Read-only compatibility for older documents that stored identity checks per line.
    refs = g.db.execute('''SELECT supplier_id,status,payload FROM v5_price_references
        WHERE owner_id=? AND document_id=? AND status IN ('verified','linked')''',
        (g.ngate_owner, document_id)).fetchall()
    ids = {row['supplier_id'] for row in refs if row['supplier_id']}
    if len(ids) == 1 and refs and all(json.loads(row['payload']).get('supplierIdentityConfirmed') is True for row in refs):
        supplier_id = next(iter(ids))
        master = master_supplier(supplier_id)
        quoted_name = document.get('quotedSupplierName')
        identity_matches = bool(master and quoted_name and supplier_identity(quoted_name)
                                and supplier_identity(quoted_name) == supplier_identity(master['supplierName']))
        all_overridden = all(json.loads(row['payload']).get('supplierOverrideConfirmed') is True for row in refs)
        if master and (identity_matches or all_overridden or not quoted_name):
            return {
                'confirmedSupplierId': supplier_id, 'supplierIdentityConfirmed': True,
                'supplierOverrideConfirmed': all_overridden, 'supplierConfirmedAt': None,
            }
    return {
        'confirmedSupplierId': None, 'supplierIdentityConfirmed': False,
        'supplierOverrideConfirmed': False, 'supplierConfirmedAt': None,
    }


def reference_payload(row, document=None, confirmation=None):
    line = json.loads(row['payload'])
    if document is None:
        parent = g.db.execute('SELECT payload FROM v5_quotation_documents WHERE owner_id=? AND id=?',
                              (g.ngate_owner, row['document_id'])).fetchone()
        document = json.loads(parent['payload']) if parent else {}
    if confirmation is None:
        confirmation = document_supplier_state(row['document_id'], document)
    supplier_row = g.db.execute('SELECT name FROM suppliers WHERE id=?', (row['supplier_id'],)).fetchone() if row['supplier_id'] else None
    master = master_supplier(row['supplier_id']) if row['supplier_id'] else None
    line.update(referenceId=row['id'], documentId=row['document_id'], documentName=document.get('documentName'),
                documentPath=document.get('documentPath'), quotedSupplierName=document.get('quotedSupplierName'),
                quotationDateText=document.get('quotationDateText'), validityText=document.get('validityText'),
                deliveryWording=document.get('deliveryWording'), conditionalDiscounts=document.get('conditionalDiscounts', []),
                productId=row['product_id'], supplierId=row['supplier_id'],
                supplierName=supplier_row['name'] if supplier_row else master['supplierName'] if master else None,
                status=row['status'], linkedRfqId=line.get('linkedRfqId'), createdAt=row['created_at'])
    if row['supplier_id'] == confirmation['confirmedSupplierId']:
        line['supplierIdentityConfirmed'] = confirmation['supplierIdentityConfirmed']
        line['supplierOverrideConfirmed'] = confirmation['supplierOverrideConfirmed']
    line.setdefault('unitConversionConfirmed', False)
    line.setdefault('unitConversionNote', None)
    line.setdefault('reviewEvidence', None)
    line.setdefault('packConversionEvidence', None)
    return line


def document_payload(document_id):
    row = g.db.execute('SELECT payload FROM v5_quotation_documents WHERE owner_id=? AND id=?',
                       (g.ngate_owner, document_id)).fetchone()
    require(row is not None, 'Quotation document not found in your account.', 404)
    document = json.loads(row['payload'])
    rows = g.db.execute('SELECT * FROM v5_price_references WHERE owner_id=? AND document_id=? ORDER BY created_at,rowid',
                        (g.ngate_owner, document_id)).fetchall()
    confirmation = document_supplier_state(document_id, document)
    document.update(confirmation)
    document['items'] = [reference_payload(ref, document, confirmation) for ref in rows]
    return document


def price_reference_row(reference_id):
    row = g.db.execute('SELECT * FROM v5_price_references WHERE owner_id=? AND id=?',
                       (g.ngate_owner, reference_id)).fetchone()
    require(row is not None, 'Supplier price reference not found in your account.', 404)
    return row

def import_quotation_document(data):
    allowed = {'documentId', 'documentName', 'documentPath', 'fingerprint', 'quotedSupplierName', 'quotationDateText',
               'validityText', 'deliveryWording', 'conditionalDiscounts', 'items', 'notes'}
    fields(data, allowed)
    document_id, fingerprint = data.get('documentId'), data.get('fingerprint')
    require(isinstance(document_id, str) and 1 <= len(document_id) <= 200, 'Quotation document ID is required.')
    require(isinstance(fingerprint, str) and re.fullmatch(r'[0-9a-f]{64}', fingerprint), 'Invalid quotation document fingerprint.')
    require(isinstance(data.get('documentName'), str) and 1 <= len(data['documentName']) <= 180, 'Document name is required.')
    require(isinstance(data.get('documentPath'), str) and data['documentPath'].startswith('/objects/'), 'Private quotation document path is required.')
    for key in ('quotedSupplierName', 'quotationDateText', 'validityText', 'deliveryWording'):
        require(data.get(key) is None or isinstance(data[key], str) and len(data[key]) <= 500, 'Invalid quotation document evidence.')
    discounts, notes, items = data.get('conditionalDiscounts'), data.get('notes'), data.get('items')
    require(isinstance(discounts, list) and len(discounts) <= 20 and all(isinstance(x, str) and len(x) <= 500 for x in discounts),
            'Invalid conditional discount evidence.')
    require(isinstance(notes, list) and len(notes) <= 12 and all(isinstance(x, str) and len(x) <= 500 for x in notes), 'Invalid extraction notes.')
    require(isinstance(items, list) and 1 <= len(items) <= 100, 'Review at least one quotation line item before importing.')
    duplicate = g.db.execute('SELECT 1 FROM v5_quotation_documents WHERE owner_id=? AND (id=? OR fingerprint=?)',
                             (g.ngate_owner, document_id, fingerprint)).fetchone()
    require(duplicate is None, 'This quotation document has already been imported. Existing line items were left unchanged.', 409)
    item_allowed = {'lineItemId', 'description', 'sku', 'unit', 'packSpecification', 'quotedQuantity', 'unitPrice', 'itemDiscount', 'lineTotal'}
    line_ids = set()
    created_at = stamp()
    document = {key: data.get(key) for key in allowed if key not in ('items', 'notes')}
    document.update(
        notes=notes, createdAt=created_at, confirmedSupplierId=None,
        supplierIdentityConfirmed=False, supplierOverrideConfirmed=False, supplierConfirmedAt=None,
    )
    g.db.execute('INSERT INTO v5_quotation_documents(owner_id,id,fingerprint,payload,created_at) VALUES(?,?,?,?,?)',
                 (g.ngate_owner, document_id, fingerprint, encoded(document), created_at))
    for item in items:
        fields(item, item_allowed)
        line_id = item.get('lineItemId')
        require(isinstance(line_id, str) and re.fullmatch(r'line-\d{3}', line_id) and line_id not in line_ids, 'Quotation line IDs must be unique.')
        line_ids.add(line_id)
        for key in ('description', 'sku', 'unit', 'packSpecification', 'itemDiscount'):
            require(item.get(key) is None or isinstance(item[key], str) and len(item[key]) <= 500, 'Invalid quotation line evidence.')
        qty = item.get('quotedQuantity')
        require(qty is None or type(qty) is int and 1 <= qty <= 1_000_000, 'Quoted quantity must be a positive whole number or unknown.')
        for key in ('unitPrice', 'lineTotal'):
            value = item.get(key)
            require(value is None or type(value) in (int, float) and 0 <= value <= 1_000_000 and math.isfinite(value),
                    'Quotation amounts must be valid non-negative numbers or unknown.')
        reference_id = new_id('REF')
        line = dict(item, supplierIdentityConfirmed=False, supplierOverrideConfirmed=False, productMatchConfirmed=False,
                    packUomConfirmed=False, priceConfirmed=False, unitConversionConfirmed=False,
                    unitConversionNote=None, reviewEvidence=None, packConversionEvidence=None,
                    verifiedAt=None, linkedRfqId=None)
        g.db.execute('''INSERT INTO v5_price_references
            (id,owner_id,document_id,line_item_id,product_id,supplier_id,status,payload,created_at)
            VALUES(?,?,?,?,NULL,NULL,'pending',?,?)''',
                     (reference_id, g.ngate_owner, document_id, line_id, encoded(line), created_at))
    event('Supplier quotation document imported', 'Pending line review',
          f'{len(items)} line item(s) extracted from {data["documentName"]}; no RFQ or MOQ was created.')
    return document_payload(document_id)


def confirm_quotation_supplier(data):
    fields(data, {'documentId', 'supplierId', 'supplierIdentityConfirmed', 'supplierOverrideConfirmed'})
    document_id, supplier_id = data.get('documentId'), data.get('supplierId')
    require(isinstance(document_id, str), 'Quotation document ID is required.')
    document_row = g.db.execute('SELECT payload FROM v5_quotation_documents WHERE owner_id=? AND id=?',
                                (g.ngate_owner, document_id)).fetchone()
    require(document_row is not None, 'Quotation document not found in your account.', 404)
    document = json.loads(document_row['payload'])
    master = master_supplier(supplier_id)
    require(master is not None, 'Choose a registered supplier from Supplier Master Data.')
    require(data.get('supplierIdentityConfirmed') is True and type(data.get('supplierOverrideConfirmed')) is bool,
            'Confirm the supplier identity and explicitly record any mismatch override.')
    quoted_name = document.get('quotedSupplierName')
    identity_matches = bool(quoted_name and supplier_identity(quoted_name)
                            and supplier_identity(quoted_name) == supplier_identity(master['supplierName']))
    mismatch = not identity_matches
    require(not mismatch or data.get('supplierOverrideConfirmed') is True,
            'An unknown or mismatched company name requires an explicit human verification override.')
    # F-I are verified Supplier Master entries but are not in the legacy SQLite
    # directory. Register the exact master identity only after owner confirmation;
    # this satisfies existing FK constraints without activating any product pair.
    register_master_supplier(g.db, supplier_id)
    current = document_supplier_state(document_id, document)
    if (document.get('confirmedSupplierId') == supplier_id
            and document.get('supplierIdentityConfirmed') is True):
        return document_payload(document_id)
    if current['confirmedSupplierId'] and current['confirmedSupplierId'] != supplier_id:
        locked = g.db.execute('''SELECT 1 FROM v5_price_references
            WHERE owner_id=? AND document_id=? AND status IN ('verified','linked') LIMIT 1''',
            (g.ngate_owner, document_id)).fetchone()
        require(not locked, 'Supplier identity is already used by verified quotation lines; existing evidence was not changed.', 409)

    document.update(
        confirmedSupplierId=supplier_id, supplierIdentityConfirmed=True,
        supplierOverrideConfirmed=data['supplierOverrideConfirmed'], supplierConfirmedAt=stamp(),
    )
    g.db.execute('UPDATE v5_quotation_documents SET payload=? WHERE owner_id=? AND id=?',
                 (encoded(document), g.ngate_owner, document_id))
    pending = g.db.execute('''SELECT id,payload FROM v5_price_references
        WHERE owner_id=? AND document_id=? AND status='pending' ''',
        (g.ngate_owner, document_id)).fetchall()
    for row in pending:
        line = json.loads(row['payload'])
        line.update(
            supplierIdentityConfirmed=False, supplierOverrideConfirmed=False,
            productMatchConfirmed=False, packUomConfirmed=False, priceConfirmed=False,
            unitConversionConfirmed=False, unitConversionNote=None, reviewEvidence=None,
            packConversionEvidence=None, verifiedAt=None,
        )
        g.db.execute('UPDATE v5_price_references SET supplier_id=?,payload=? WHERE owner_id=? AND id=?',
                     (supplier_id, encoded(line), g.ngate_owner, row['id']))
    event('Quotation supplier identity confirmed', 'Owner confirmed',
          'Supplier identity confirmed once for this document; line-level product, pack/UOM and price review is still required.',
          sid=supplier_id)
    return document_payload(document_id)


def review_price_reference(data):
    fields(data, {'referenceId', 'productId', 'unitConversionConfirmed', 'unitConversionNote'})
    row = price_reference_row(data.get('referenceId'))
    require(row['status'] == 'pending', 'Only a pending quotation line can be assigned; existing verified evidence was left unchanged.', 409)
    pid = data.get('productId')
    if pid is not None:
        product(pid)
    conversion_confirmed = data.get('unitConversionConfirmed', False)
    conversion_note = data.get('unitConversionNote')
    require(type(conversion_confirmed) is bool, 'Unit conversion confirmation must be an explicit boolean.')
    require(conversion_note is None or isinstance(conversion_note, str) and len(conversion_note) <= 500,
            'Unit conversion evidence must be 500 characters or fewer.')
    payload = json.loads(row['payload'])
    parent = g.db.execute('SELECT payload FROM v5_quotation_documents WHERE owner_id=? AND id=?',
                          (g.ngate_owner, row['document_id'])).fetchone()
    document = json.loads(parent['payload'])
    confirmation = document_supplier_state(row['document_id'], document)
    product_changed = pid != row['product_id']
    if product_changed or pid is None:
        conversion_confirmed, conversion_note = False, None
    elif requires_pack_multiplier(payload.get('unit'), product(pid)['unit']):
        conversion_confirmed, conversion_note = False, None
    elif conversion_confirmed:
        require(isinstance(conversion_note, str) and bool(conversion_note.strip()),
                'Describe the exact one-to-one unit/pack equivalence you reviewed.')
        require(normalized_unit(payload.get('unit')) != normalized_unit(product(pid)['unit']),
                'No conversion note is needed when the quoted unit already matches the catalogue unit.')
    else:
        conversion_note = None
    payload.update(
        supplierIdentityConfirmed=False, supplierOverrideConfirmed=False, productMatchConfirmed=False,
        packUomConfirmed=False, priceConfirmed=False, unitConversionConfirmed=conversion_confirmed,
        unitConversionNote=conversion_note.strip() if conversion_note else None,
        reviewEvidence=None, packConversionEvidence=None,
        verifiedAt=None, linkedRfqId=None,
    )
    supplier_id = confirmation['confirmedSupplierId'] or row['supplier_id']
    g.db.execute('UPDATE v5_price_references SET product_id=?,supplier_id=?,status="pending",payload=? WHERE owner_id=? AND id=?',
                 (pid, supplier_id, encoded(payload), g.ngate_owner, row['id']))
    event('Supplier price reference assignment saved', 'Pending human review',
          f'{payload.get("description") or "Quotation line"}; no supplier/product authorization was created.',
          pid, supplier_id)
    return reference_payload(price_reference_row(row['id']))


def verify_price_references(data):
    fields(data, {'documentId', 'references'})
    document_id, selected = data.get('documentId'), data.get('references')
    require(isinstance(document_id, str), 'Quotation document ID is required.')
    require(isinstance(selected, list) and 1 <= len(selected) <= 100, 'Select at least one line to verify.')
    document_row = g.db.execute('SELECT payload FROM v5_quotation_documents WHERE owner_id=? AND id=?',
                                (g.ngate_owner, document_id)).fetchone()
    require(document_row is not None, 'Quotation document not found in your account.', 404)
    document = json.loads(document_row['payload'])
    confirmation = document_supplier_state(document_id, document)
    supplier_id = confirmation['confirmedSupplierId']
    require(supplier_id and confirmation['supplierIdentityConfirmed'],
            'Confirm the supplier identity for this document before verifying quotation lines.')
    master = master_supplier(supplier_id)
    require(master is not None, 'The confirmed supplier is not in Supplier Master Data.')
    selected_ids = set()
    prepared = []
    allowed = {'referenceId', 'productId', 'unitConversionConfirmed', 'unitConversionNote', 'cataloguePackConfirmed'}
    for entry in selected:
        fields(entry, allowed)
        reference_id, pid = entry.get('referenceId'), entry.get('productId')
        require(isinstance(reference_id, str) and reference_id not in selected_ids, 'Selected quotation line IDs must be unique.')
        selected_ids.add(reference_id)
        row = price_reference_row(reference_id)
        require(row['document_id'] == document_id and row['status'] == 'pending',
                'Every selected line must be pending in this quotation document.', 409)
        require(isinstance(pid, str), 'Choose a catalogue product for every selected line.')
        p = product(pid)
        line = json.loads(row['payload'])
        require(bool(line.get('description') or line.get('sku')), 'A line without a readable product description or SKU must stay pending.')
        identity_issue = quotation_product_issue(line, p)
        require(identity_issue is None, identity_issue or 'The printed product evidence conflicts with the catalogue item.')
        require(type(line.get('unitPrice')) in (int, float) and line['unitPrice'] > 0,
                'A line without a clear positive unit price must stay pending.')
        unit_matches = normalized_unit(line.get('unit')) == normalized_unit(p['unit'])
        conversion_confirmed = entry.get('unitConversionConfirmed', False)
        conversion_note = entry.get('unitConversionNote')
        catalogue_pack_confirmed = entry.get('cataloguePackConfirmed', False)
        require(type(conversion_confirmed) is bool, 'Unit conversion confirmation must be an explicit boolean.')
        require(type(catalogue_pack_confirmed) is bool, 'Catalogue pack confirmation must be an explicit boolean.')
        require(conversion_note is None or isinstance(conversion_note, str) and len(conversion_note) <= 500,
                'Unit conversion evidence must be 500 characters or fewer.')
        conversion_evidence = None
        if requires_pack_multiplier(line.get('unit'), p['unit']):
            require(not conversion_confirmed and not conversion_note,
                    'Outer-pack conversion needs a verified pack multiplier and cannot use a one-to-one confirmation note.')
            conversion_evidence, conversion_issue = verified_pack_conversion(
                line, p, catalogue_pack_confirmed,
            )
            require(conversion_evidence is not None, conversion_issue or 'The printed pack conversion is not verified.')
        elif not unit_matches:
            require(conversion_confirmed and isinstance(conversion_note, str) and bool(conversion_note.strip()),
                    f'{line.get("description") or "Selected line"} has a different quoted unit. Explicitly review and record a one-to-one pack/UOM equivalence.')
        else:
            require(not catalogue_pack_confirmed,
                    'Catalogue pack confirmation is only used when an outer-pack conversion has an unknown catalogue size.')
            require(not conversion_confirmed or isinstance(conversion_note, str) and bool(conversion_note.strip()),
                    'A confirmed unit conversion requires a review note.')
        prepared.append((row, line, p, conversion_confirmed, conversion_note.strip() if conversion_note else None, conversion_evidence))

    verified = []
    for row, line, p, conversion_confirmed, conversion_note, conversion_evidence in prepared:
        verified_at = stamp()
        line.update(
            supplierIdentityConfirmed=True,
            supplierOverrideConfirmed=confirmation['supplierOverrideConfirmed'],
            productMatchConfirmed=True, packUomConfirmed=True, priceConfirmed=True,
            unitConversionConfirmed=conversion_confirmed, unitConversionNote=conversion_note,
            packConversionEvidence=conversion_evidence,
            reviewConfirmed=True, verifiedAt=verified_at, linkedRfqId=None,
            reviewEvidence={
                'supplierId': supplier_id, 'supplierName': master['supplierName'],
                'productId': p['id'], 'productName': p['name'],
                'quotedUnit': line.get('unit'), 'catalogueUnit': p['unit'],
                'quotedPackSpecification': line.get('packSpecification'),
                'cataloguePackSize': p['pack_size'] or None,
                'quotedUnitPrice': line['unitPrice'], 'reviewedAt': verified_at,
            },
        )
        g.db.execute('''UPDATE v5_price_references SET product_id=?,supplier_id=?,status='verified',payload=?
            WHERE owner_id=? AND id=?''',
            (p['id'], supplier_id, encoded(line), g.ngate_owner, row['id']))
        event('Supplier price reference verified', 'Owner reviewed selected line',
              f'{line.get("description") or "Quotation line"}; original unit price and quoted quantity retained; quantity is not MOQ.'
              + (f'; verified {conversion_evidence["unitsPerOuter"]} {conversion_evidence["innerUnit"]} per {conversion_evidence["outerUnit"]}.' if conversion_evidence else ''),
              p['id'], supplier_id)
        verified.append(reference_payload(price_reference_row(row['id']), document, confirmation))
    return verified


def link_price_reference(data):
    fields(data, {'referenceId', 'rfqId', 'confirmLink'})
    require(data.get('confirmLink') is True, 'Explicitly confirm linking this verified reference to the RFQ.')
    row = price_reference_row(data.get('referenceId'))
    ref = reference_payload(row)
    require(row['status'] == 'verified', 'Verify the supplier price reference before linking it to an RFQ.')
    require(not ref.get('linkedRfqId'), 'This price reference is already linked to an RFQ.')
    rfq = owned('v5_rfqs', data.get('rfqId'))
    require(rfq['productId'] == row['product_id'] and any(s['supplierId'] == row['supplier_id'] for s in rfq['suppliers']),
            'The selected RFQ must include the same product and supplier.')
    existing = g.db.execute('SELECT 1 FROM v5_quotes WHERE owner_id=? AND rfq_id=? AND supplier_id=?',
                             (g.ngate_owner, rfq['rfqId'], row['supplier_id'])).fetchone()
    require(existing is None, 'This RFQ already has a quotation from the selected supplier. Existing quote and PO history were not changed.', 409)
    parent = g.db.execute('SELECT payload FROM v5_quotation_documents WHERE owner_id=? AND id=?',
                          (g.ngate_owner, row['document_id'])).fetchone()
    document = json.loads(parent['payload'])
    quote = save_quote({
        'rfqId': rfq['rfqId'], 'supplierId': row['supplier_id'], 'unitPrice': ref['unitPrice'],
        'minimumOrderQuantity': None, 'orderMultiple': None, 'leadTimeDays': None, 'leadTimeBasis': 'unknown',
        'leadTimeText': document.get('deliveryWording'), 'quotedDeliveryDate': None, 'source': 'document-upload',
        'documentId': document['documentId'], 'documentName': document['documentName'], 'documentPath': document['documentPath'],
        'quotedSupplierName': document.get('quotedSupplierName'), 'quotedProductName': ref.get('description'),
        'quotedUnit': ref.get('unit'), 'packDescription': ref.get('packSpecification'), 'confidence': 'human-reviewed-reference',
        'needsHumanReview': False, 'reviewConfirmed': True, 'packUomConfirmed': True,
        'supplierOverrideConfirmed': ref.get('supplierOverrideConfirmed') is True,
        'unitConversionConfirmed': ref.get('unitConversionConfirmed') is True,
        'unitConversionNote': ref.get('unitConversionNote'),
         'normalizedUnitPrice': (
             ref.get('packConversionEvidence', {}).get('normalizedUnitPrice')
             if ref.get('packConversionEvidence') else None
         ),
         'packConversionEvidence': ref.get('packConversionEvidence'),
        'deliveryDateConfirmed': False, 'deliveryConfirmationSource': None, 'deliveryConfirmationNote': None,
        'documentQuotedDeliveryDate': None,
    }, source_line_evidence={
        'referenceId': row['id'], 'lineItemId': row['line_item_id'],
        'quotedQuantity': ref.get('quotedQuantity'), 'itemDiscount': ref.get('itemDiscount'),
        'lineTotal': ref.get('lineTotal'), 'reviewEvidence': ref.get('reviewEvidence'),
         'packConversionEvidence': ref.get('packConversionEvidence'),
        'conditionalDiscounts': document.get('conditionalDiscounts', []),
    })
    payload = json.loads(row['payload'])
    payload['linkedRfqId'] = rfq['rfqId']
    g.db.execute("UPDATE v5_price_references SET status='linked',payload=? WHERE owner_id=? AND id=?",
                 (encoded(payload), g.ngate_owner, row['id']))
    event('Supplier price reference linked to RFQ', 'Human confirmed RFQ link',
          'No quoted quantity was treated as MOQ; no conditional discount or delivery promise was inferred.',
          rfq['productId'], row['supplier_id'], rfq['rfqId'])
    return quote


def event(action, status, details, pid=None, sid=None, rid=None, po=None):
    entry = dict(eventId=new_id('EV'), timestamp=stamp(), actor='Account owner', action=action, status=status, details=details,
                 productId=pid, productName=product(pid)['name'] if pid else None, supplierId=sid, rfqId=rid, poNumber=po)
    g.db.execute('INSERT INTO v5_activity VALUES(?,?,?,?)', (entry['eventId'], g.ngate_owner, entry['timestamp'], encoded(entry)))
    return entry


def create_rfq(data):
    fields(data, {'productId', 'requestedQuantity', 'requestedDeliveryDate', 'supplierIds'})
    p = product(data.get('productId'))
    quantity = integer(data.get('requestedQuantity'), 'Requested quantity')
    delivery = day(data.get('requestedDeliveryDate'))
    ids = data.get('supplierIds')
    require(isinstance(ids, list) and 0 < len(ids) <= 20 and all(isinstance(s, str) for s in ids) and len(ids) == len(set(ids)), 'Choose distinct valid suppliers.')
    require(all(supplier_is_eligible(p['id'], sid) for sid in ids),
            'Supplier/product relationship is not supported by the verified documents or is pending pack/UOM review. Historical records are unchanged.')
    suppliers = [dict(supplierId=sid, supplierName=supplier(p['id'], sid)['name'], status='prepared') for sid in ids]
    rfq = dict(rfqId=new_id('RFQ'), productId=p['id'], requestedQuantity=quantity, requestedDeliveryDate=delivery, suppliers=suppliers, createdAt=stamp())
    g.db.execute('INSERT INTO v5_rfqs VALUES(?,?,?,?,?)', (rfq['rfqId'], g.ngate_owner, p['id'], encoded(rfq), rfq['createdAt']))
    event('Quotation request prepared', 'Not sent', f'{quantity} {p["unit"]}; manual WhatsApp draft only.', p['id'], rid=rfq['rfqId'])
    return rfq


def contact(data, sent):
    fields(data, {'rfqId', 'supplierId'})
    rfq = owned('v5_rfqs', data.get('rfqId'))
    target = next((s for s in rfq['suppliers'] if s['supplierId'] == data.get('supplierId')), None)
    require(target is not None, 'Supplier is not part of this RFQ.')
    if target['status'] == 'marked-sent' or (not sent and target.get('whatsappOpenedAt')):
        return rfq
    if sent:
        target.update(status='marked-sent', markedSentAt=stamp())
    else:
        target.update(status='whatsapp-opened', whatsappOpenedAt=stamp())
    g.db.execute('UPDATE v5_rfqs SET payload=? WHERE owner_id=? AND id=?', (encoded(rfq), g.ngate_owner, rfq['rfqId']))
    event('Marked as sent by owner' if sent else 'WhatsApp draft opened', 'Owner confirmed' if sent else 'Not sent', 'NGate did not transmit a message.', rfq['productId'], target['supplierId'], rfq['rfqId'])
    return rfq


def save_quote(data, synthetic=False, source_line_evidence=None):
    fields(data, EVIDENCE | {'rfqId', 'supplierId', 'unitPrice', 'minimumOrderQuantity', 'orderMultiple',
                             'leadTimeDays', 'quotedDeliveryDate', 'source', 'documentId', 'documentName',
                             'documentPath', 'normalizedUnitPrice', 'packConversionEvidence'})
    rfq = owned('v5_rfqs', data.get('rfqId'))
    p = product(rfq['productId'])
    s = supplier(p['id'], data.get('supplierId'))
    require(any(x['supplierId'] == s['id'] for x in rfq['suppliers']), 'Supplier is not included in this RFQ.')
    price = money(data.get('unitPrice'))
    normalized_price_value = data.get('normalizedUnitPrice')
    normalized_price = precise_unit_price(normalized_price_value) if normalized_price_value is not None else None
    pack_conversion = data.get('packConversionEvidence')
    moq_value = data.get('minimumOrderQuantity')
    moq = integer(moq_value, 'MOQ') if moq_value is not None else None
    multiple = data.get('orderMultiple')
    if multiple is not None:
        integer(multiple, 'Order multiple')
    lead = data.get('leadTimeDays')
    if lead is not None:
        integer(lead, 'Lead time', True)
        require(lead <= 3650, 'Lead time is too large.')
    basis = data.get('leadTimeBasis', 'unknown')
    require(basis in ('working-days', 'calendar-days', 'unknown'), 'Invalid lead-time basis.')
    flags = {'needsHumanReview', 'reviewConfirmed', 'packUomConfirmed', 'supplierOverrideConfirmed',
             'deliveryDateConfirmed', 'unitConversionConfirmed'}
    for key in EVIDENCE - flags:
        require(data.get(key) is None or isinstance(data[key], str) and len(data[key]) <= 500, 'Invalid quotation evidence: ' + key)
    for key in flags:
        require(data.get(key) is None or type(data[key]) is bool, 'Review flags must be boolean.')
    source = data.get('source')
    existing_row = g.db.execute('SELECT id,payload FROM v5_quotes WHERE owner_id=? AND rfq_id=? AND supplier_id=?', (g.ngate_owner, rfq['rfqId'], s['id'])).fetchone()
    existing_quote_payload = json.loads(existing_row['payload']) if existing_row else None
    existing_source = existing_quote_payload.get('source') if existing_quote_payload else None
    existing_conversion = existing_quote_payload.get('packConversionEvidence') if existing_quote_payload else None
    if existing_conversion:
        require(
            source == 'document-upload'
            and data.get('documentId') == existing_quote_payload.get('documentId')
            and normalized_unit(data.get('quotedUnit')) == normalized_unit(existing_quote_payload.get('quotedUnit'))
            and price == money(existing_quote_payload.get('unitPrice')),
            'This converted quote cannot be replaced without re-reviewing its original document line. Original evidence and purchase history were left unchanged.',
            409,
        )
        if pack_conversion is None:
            pack_conversion = existing_conversion
            normalized_price = precise_unit_price(existing_quote_payload.get('normalizedUnitPrice'))
            source_line_evidence = existing_quote_payload.get('sourceLineEvidence')
        else:
            require(pack_conversion == existing_conversion
                    and normalized_price == precise_unit_price(existing_quote_payload.get('normalizedUnitPrice')),
                    'This converted quote’s verified pack evidence cannot be replaced by the quotation editor.', 409)
    require(source in ('manual', 'document-upload', 'demo-example') and (source != 'demo-example' or synthetic or existing_source == 'demo-example'), 'Invalid quotation source.')
    name = data.get('quotedSupplierName')
    mismatch = bool(name and (not supplier_identity(name) or supplier_identity(name) != supplier_identity(s['name'])))
    require(not mismatch or data.get('supplierOverrideConfirmed') is True and data.get('reviewConfirmed') is True, 'Supplier identity mismatch requires explicit owner override and review.')
    evidence_present = source == 'document-upload' or any(data.get(k) for k in ('quotedProductName', 'quotedUnit', 'packDescription'))
    require(not evidence_present or data.get('reviewConfirmed') is True and not data.get('needsHumanReview'), 'Verify supplier, SKU, units and pack before saving.')
    if pack_conversion is not None:
        require(source == 'document-upload' and isinstance(pack_conversion, dict),
                'Pack conversion evidence must come from a reviewed quotation document.')
        require(normalized_price is not None and valid_pack_conversion(
            pack_conversion, data.get('quotedUnit'), p['unit'], price, normalized_price,
        ), 'The normalized unit price does not match the reviewed pack conversion.')
        require(isinstance(source_line_evidence, dict)
                and source_line_evidence.get('packConversionEvidence') == pack_conversion
                and source_line_evidence.get('quotedQuantity') == pack_conversion.get('quotedQuantity')
                and source_line_evidence.get('lineTotal') == pack_conversion.get('originalLineTotal'),
                'The original quotation quantity and line total must remain attached to the conversion evidence.')
    else:
        require(normalized_price is None, 'A normalized price requires verified outer-pack conversion evidence.')
    if data.get('unitConversionConfirmed') is True:
        require(isinstance(data.get('unitConversionNote'), str) and bool(data['unitConversionNote'].strip()),
                'A confirmed one-to-one unit conversion requires a review note.')
    if source == 'document-upload':
        require(isinstance(data.get('documentId'), str) and bool(data['documentId']), 'Uploaded quotation document reference required.')
    # Preserve stated evidence, never invent a calendar promise from working days.
    delivery = day(data.get('quotedDeliveryDate'), True)
    confirmation_source = data.get('deliveryConfirmationSource')
    require(confirmation_source in (None, 'document', 'supplier-contact'), 'Invalid delivery confirmation source.')
    if delivery:
        require(data.get('deliveryDateConfirmed') is True, 'Explicitly confirm the supplier delivery promise, or choose lead time only.')
        require(confirmation_source == 'document' and source == 'document-upload' and data.get('documentQuotedDeliveryDate') == delivery
                or confirmation_source == 'supplier-contact',
                'Record whether this exact date came from the document or supplier contact.')
    else:
        require(not data.get('deliveryDateConfirmed'), 'A confirmed promise requires a delivery date.')
    lead_text = data.get('leadTimeText')
    if lead is not None and lead_text and re.search(r'working|business|bekerja', lead_text, re.I):
        basis = 'working-days'
    row = existing_row
    old = json.loads(row['payload']) if row else None
    if old and old.get('documentQuotedDeliveryDate') and old.get('documentId') == data.get('documentId'):
        require(data.get('documentQuotedDeliveryDate') == old['documentQuotedDeliveryDate'], 'Preserve original document delivery evidence when editing.')
    previous = g.db.execute('SELECT unit_price FROM purchase_history WHERE product_id=? AND supplier_id=? ORDER BY purchase_date DESC LIMIT 1', (p['id'], s['id'])).fetchone()
    quote = {key: data[key] for key in EVIDENCE if key in data}
    quote.update(quoteId=row['id'] if row else new_id('QT'), rfqId=rfq['rfqId'], productId=p['id'], supplierId=s['id'], supplierName=s['name'],
                 unitPrice=float(price), previousUnitPrice=previous['unit_price'] if previous else None, minimumOrderQuantity=moq,
                 normalizedUnitPrice=float(normalized_price) if normalized_price is not None else None,
                 packConversionEvidence=pack_conversion,
                 orderMultiple=multiple, leadTimeDays=lead, leadTimeBasis=basis, quotedDeliveryDate=delivery, source=source,
                 documentId=data.get('documentId'), documentName=data.get('documentName'), documentPath=data.get('documentPath'),
                 supplierProductRelationshipConfirmed=True,
                 receivedAt=old['receivedAt'] if old else stamp(), updatedAt=stamp())
    if source_line_evidence is not None:
        quote['sourceLineEvidence'] = source_line_evidence
    elif old and old.get('documentId') == data.get('documentId') and old.get('sourceLineEvidence') is not None:
        quote['sourceLineEvidence'] = old['sourceLineEvidence']
    if row:
        g.db.execute('UPDATE v5_quotes SET payload=? WHERE owner_id=? AND id=?', (encoded(quote), g.ngate_owner, quote['quoteId']))
    else:
        g.db.execute('INSERT INTO v5_quotes VALUES(?,?,?,?,?)', (quote['quoteId'], g.ngate_owner, rfq['rfqId'], s['id'], encoded(quote)))
    labels = {'unitPrice': 'unit price', 'minimumOrderQuantity': 'minimum order', 'orderMultiple': 'order multiple',
              'leadTimeDays': 'lead time', 'leadTimeBasis': 'lead time basis', 'quotedDeliveryDate': 'promised date',
              'deliveryDateConfirmed': 'delivery verification', 'deliveryConfirmationSource': 'confirmation source',
              'deliveryConfirmationNote': 'supplier confirmation note', 'documentId': 'source document'}
    changed = ', '.join(label for key, label in labels.items() if old and old.get(key) != quote.get(key))
    event('Supplier quotation updated' if row else 'Supplier quotation recorded', 'Human reviewed' if data.get('reviewConfirmed') else 'Manual entry',
          f'RM{price:.2f}; MOQ {moq if moq is not None else "not stated"}; delivery {delivery or "unconfirmed"}. Source: {source}.'
          + (f' Changed: {changed}.' if changed else '')
          + (f' Supplier confirmation: {confirmation_source}; {data.get("deliveryConfirmationNote") or "document promise reviewed"}.' if delivery else ''),
          p['id'], s['id'], rfq['rfqId'])
    return quote


def create_po(data):
    fields(data, {'productId', 'supplierId', 'qty', 'unitPrice', 'rfqId', 'quoteId', 'historicalPriceConfirmed'})
    p = product(data.get('productId'))
    s = supplier(p['id'], data.get('supplierId'))
    qty = integer(data.get('qty'), 'PO quantity')
    rid, qid = data.get('rfqId'), data.get('quoteId')
    quote = owned('v5_quotes', qid) if qid else None
    pack_conversion = quote.get('packConversionEvidence') if quote else None
    price = precise_unit_price(data.get('unitPrice')) if pack_conversion else money(data.get('unitPrice'))
    rfq = None
    if rid:
        rfq = owned('v5_rfqs', rid)
        require(rfq['productId'] == p['id'] and any(x['supplierId'] == s['id'] for x in rfq['suppliers']), 'RFQ/product/supplier mismatch.')
        require(qty >= rfq['requestedQuantity'], f'Partial orders are not supported. RFQ requests {rfq["requestedQuantity"]}; shortfall: {max(0, rfq["requestedQuantity"] - qty)}.')
    order_pack_count = None
    order_pack_unit = None
    order_pack_multiplier = None
    order_pack_extra_quantity = None
    if qid:
        require(quote['rfqId'] == rid and quote['productId'] == p['id'] and quote['supplierId'] == s['id'], 'Quote/RFQ/product/supplier mismatch.')
        if pack_conversion:
            normalized_price = quote.get('normalizedUnitPrice')
            require(valid_pack_conversion(
                pack_conversion, quote.get('quotedUnit'), p['unit'], quote.get('unitPrice'), normalized_price,
            ), 'The quotation pack conversion is invalid. Re-review the source quotation before preparing this PO.', 409)
            require(price == precise_unit_price(normalized_price),
                    'Price differs from the reviewed normalized unit price. Edit the quotation first.', 409)
            order_pack_multiplier = pack_conversion['unitsPerOuter']
            require(qty % order_pack_multiplier == 0,
                    f'Order quantity must be a whole number of {pack_conversion["outerUnit"]}s ({order_pack_multiplier} {p["unit"]}s each).',
                    409)
            order_pack_count = qty // order_pack_multiplier
            order_pack_unit = pack_conversion['outerUnit']
            order_pack_extra_quantity = max(0, qty - rfq['requestedQuantity']) if rfq else None
        else:
            require(price == money(quote['unitPrice']), 'Price differs from the reviewed quote. Edit the quotation first.', 409)
        relationship_confirmed = supplier_is_eligible(p['id'], s['id'])
        require(compatible_quote({**quote, 'supplierProductRelationshipConfirmed': relationship_confirmed}, p['unit']),
                'Confirm compatible SKU, pack and stock UOM before preparing a quotation-linked PO.')
        require((quote.get('minimumOrderQuantity') is None or qty >= quote['minimumOrderQuantity'])
                and (not quote.get('orderMultiple') or qty % quote['orderMultiple'] == 0), 'PO violates supplier MOQ or order multiple.')
    else:
        require(data.get('historicalPriceConfirmed') is True, 'Confirm the current supplier price before using purchase history.')
    dedup = hashlib.sha256(encoded([p['id'], s['id'], rid, qid, qty, str(price), None if rid else datetime.now(ZoneInfo('Asia/Kuala_Lumpur')).date().isoformat()]).encode()).hexdigest()
    existing = g.db.execute('SELECT payload FROM v5_purchase_orders WHERE owner_id=? AND dedup_key=?', (g.ngate_owner, dedup)).fetchone()
    if existing:
        return json.loads(existing['payload'])
    total = (
        Decimal(str(pack_conversion['originalUnitPrice'])) * order_pack_count
        if pack_conversion else price * qty
    ).quantize(Decimal('.01'))
    po = dict(poNumber=new_id('PO'), productId=p['id'], productName=p['name'], supplierId=s['id'], supplier=s['name'], rfqId=rid, quoteId=qid,
              qty=qty, unit=p['unit'], unitPrice=float(price), total=float(total), status='draft', preparedAt=stamp(), approvedAt=None,
              orderPackCount=order_pack_count, orderPackUnit=order_pack_unit, orderPackMultiplier=order_pack_multiplier,
              orderPackExtraQuantity=order_pack_extra_quantity,
              quoteSnapshot=quote)
    g.db.execute('INSERT INTO v5_purchase_orders VALUES(?,?,?,?,?,?,?,?)', (po['poNumber'], g.ngate_owner, p['id'], rid, qid, 'draft', dedup, encoded(po)))
    package_note = (
        f'; {order_pack_count} {order_pack_unit}(s), {qty} {p["unit"]} total'
        if order_pack_count is not None else ''
    )
    event('PO draft prepared', 'Pending approval · not sent',
          f'{po["poNumber"]}; RM{po["total"]:.2f}{package_note}; supplier not contacted.',
          p['id'], s['id'], rid, po['poNumber'])
    return po


def approve_po(data):
    fields(data, {'poNumber'})
    po = owned('v5_purchase_orders', data.get('poNumber'))
    if po['status'] == 'approved':
        return po
    require(po['status'] == 'draft', 'Only a draft can be approved.', 409)
    po.update(status='approved', approvedAt=stamp())
    g.db.execute("UPDATE v5_purchase_orders SET status='approved',payload=? WHERE owner_id=? AND id=?", (encoded(po), g.ngate_owner, po['poNumber']))
    event('PO approved by owner', 'Approved · not sent', 'Owner authorised approval; no transmission to supplier.', po['productId'], po['supplierId'], po.get('rfqId'), po['poNumber'])
    return po


def mark_po_sent(data):
    fields(data, {'poNumber', 'method', 'sentAt', 'notes'})
    po = owned('v5_purchase_orders', data.get('poNumber'))
    require(po['status'] == 'approved', 'Only an approved PO can be marked as sent.', 409)
    require(data.get('method') in ('WhatsApp', 'Email', 'Phone', 'Other'), 'Choose a valid sent method.')
    raw_sent_at = data.get('sentAt')
    require(isinstance(raw_sent_at, str) and 1 <= len(raw_sent_at) <= 64, 'A valid sent date and time is required.')
    try:
        sent_at = datetime.fromisoformat(raw_sent_at.replace('Z', '+00:00'))
    except ValueError:
        raise ProcurementError('Choose a valid sent date and time.')
    if sent_at.tzinfo is None:
        sent_at = sent_at.replace(tzinfo=ZoneInfo('Asia/Kuala_Lumpur'))
    notes = data.get('notes')
    require(notes is None or isinstance(notes, str) and len(notes) <= 500, 'Notes must be 500 characters or fewer.')
    if po.get('sentStatus') == 'sent' or po.get('markedSentAt'):
        return po
    po.update(sentStatus='sent', markedSentAt=sent_at.isoformat(), markedSentMethod=data['method'], sentNotes=notes.strip() or None if notes else None)
    g.db.execute('UPDATE v5_purchase_orders SET payload=? WHERE owner_id=? AND id=?',
                 (encoded(po), g.ngate_owner, po['poNumber']))
    detail = f'{po["poNumber"]} manually recorded as sent via {data["method"]} at {po["markedSentAt"]}. NGate did not transmit it.'
    if po['sentNotes']:
        detail += f' Note: {po["sentNotes"]}'
    event('PO marked as sent', 'Owner recorded send', detail, po['productId'], po['supplierId'], po.get('rfqId'), po['poNumber'])
    return po


def mutate(operation, data):
    if operation == 'import-quotation-document':
        return import_quotation_document(data)
    if operation == 'confirm-quotation-supplier':
        return confirm_quotation_supplier(data)
    if operation == 'review-price-reference':
        return review_price_reference(data)
    if operation == 'verify-price-references':
        return verify_price_references(data)
    if operation == 'link-price-reference':
        return link_price_reference(data)
    if operation == 'create-rfq':
        return create_rfq(data)
    if operation in ('whatsapp-opened', 'mark-sent'):
        return contact(data, operation == 'mark-sent')
    if operation == 'save-quote':
        return save_quote(data)
    if operation == 'create-po':
        return create_po(data)
    if operation == 'approve-po':
        return approve_po(data)
    if operation == 'mark-po-sent':
        return mark_po_sent(data)
    if operation == 'log-activity':
        fields(data, {'action', 'status', 'details', 'actor', 'productId', 'productName', 'supplierId', 'rfqId', 'poNumber'})
        require(data.get('action') == 'PO PDF downloaded', 'This audit action is server-managed.')
        po = owned('v5_purchase_orders', data.get('poNumber'))
        return event('PO PDF downloaded', po['status'] + ' · not sent', 'PDF downloaded; supplier not contacted.', po['productId'], po['supplierId'], po.get('rfqId'), po['poNumber'])
    if operation == 'example-quotes':
        fields(data, {'rfqId', 'confirmSynthetic'})
        require(data.get('confirmSynthetic') is True, 'Explicit synthetic example confirmation required.')
        rfq = owned('v5_rfqs', data.get('rfqId'))
        for s in rfq['suppliers']:
            exists = g.db.execute('SELECT 1 FROM v5_quotes WHERE owner_id=? AND rfq_id=? AND supplier_id=?', (g.ngate_owner, rfq['rfqId'], s['supplierId'])).fetchone()
            if not exists:
                save_quote(dict(rfqId=rfq['rfqId'], supplierId=s['supplierId'], unitPrice=10, minimumOrderQuantity=10,
                                leadTimeDays=supplier(rfq['productId'], s['supplierId'])['lead_days'], leadTimeBasis='calendar-days',
                                quotedDeliveryDate=None, source='demo-example', leadTimeText='Synthetic example only; tentative calendar-day estimate.'), True)
        return [q for q in listing('v5_quotes') if q['rfqId'] == rfq['rfqId']]
    raise ProcurementError('Unsupported operation.', 404)


@bp.route('/api/v2/procurement/<operation>', methods=['GET', 'POST'])
def procurement(operation):
    require(operation in READS | WRITES, 'Unsupported procurement operation.', 404)
    require(hasattr(g, 'ngate_owner'), 'Authenticated internal owner required.', 401)
    if request.method == 'GET':
        require(operation in READS, 'This operation requires POST.', 405)
        if operation == 'dashboard':
            latest = {}
            for rfq in listing('v5_rfqs'):
                latest.setdefault(rfq['productId'], rfq)
            return jsonify(quotationRequests=list(latest.values()),
                           quotes=[quote_public(q) for q in listing('v5_quotes')],
                           purchaseOrders=listing('v5_purchase_orders'))
        if operation == 'latest-rfq':
            pid = request.args.get('productId')
            product(pid)
            return jsonify(next((r for r in listing('v5_rfqs') if r['productId'] == pid), None))
        if operation == 'quotes':
            rfq = owned('v5_rfqs', request.args.get('rfqId'))
            return jsonify([quote_public(q) for q in listing('v5_quotes') if q['rfqId'] == rfq['rfqId']])
        if operation == 'quotation-documents':
            ids = [row['id'] for row in g.db.execute('SELECT id FROM v5_quotation_documents WHERE owner_id=? ORDER BY created_at DESC',
                                                     (g.ngate_owner,))]
            return jsonify([document_payload(document_id) for document_id in ids])
        if operation == 'price-references':
            pid = request.args.get('productId')
            product(pid)
            refs = g.db.execute('SELECT * FROM v5_price_references WHERE owner_id=? AND product_id=? ORDER BY created_at DESC',
                                (g.ngate_owner, pid)).fetchall()
            return jsonify([reference_payload(row) for row in refs])
        return jsonify(listing('v5_purchase_orders' if operation == 'orders' else 'v5_activity'))
    require(operation in WRITES, 'Read-only operation.', 405)
    key = request.headers.get('Idempotency-Key', '')
    require(bool(re.fullmatch(r'[A-Za-z0-9_-]{8,100}', key)), 'A valid idempotency key is required.')
    data = request.get_json()
    require(isinstance(data, dict), 'JSON object required.')
    digest = hashlib.sha256(encoded(data).encode()).hexdigest()
    with g.db:
        g.db.execute('BEGIN IMMEDIATE')
        previous = g.db.execute('SELECT input_hash,response FROM v5_idempotency WHERE owner_id=? AND operation=? AND request_key=?', (g.ngate_owner, operation, key)).fetchone()
        if previous:
            require(previous['input_hash'] == digest, 'Idempotency key was already used for different input.', 409)
            return jsonify(json.loads(previous['response']))
        result = mutate(operation, data)
        g.db.execute('INSERT INTO v5_idempotency VALUES(?,?,?,?,?)', (g.ngate_owner, operation, key, digest, encoded(result)))
    return jsonify(result)
