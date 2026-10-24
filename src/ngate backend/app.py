"""NGate hackathon demo backend: Flask + SQLite; no external communications."""
import io
import json
import math
import os
import re
import sqlite3
import uuid
from datetime import date, datetime, timedelta, timezone
from decimal import Decimal, InvalidOperation, ROUND_HALF_UP
from pathlib import Path
from zoneinfo import ZoneInfo

from runtime_dependencies import ensure_runtime_dependencies

ensure_runtime_dependencies()

from flask import Flask, Response, g, jsonify, request, send_file
from reportlab.lib.pagesizes import A4
from reportlab.lib.units import mm
from reportlab.pdfgen import canvas

from seed import STORE_ID, STORE_NAME, seed_database
from procurement_security import install_service_security
from procurement_migrations import migrate_procurement
from procurement_v2 import bp as procurement_blueprint
from supplier_master import active_documented_supplier, master_supplier, owner_verified_supplier_relationship

ROOT = Path(__file__).resolve().parent
SCHEMA = '''
CREATE TABLE IF NOT EXISTS stores(id TEXT PRIMARY KEY, name TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS suppliers(id TEXT PRIMARY KEY, name TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS products(
 id TEXT PRIMARY KEY,store_id TEXT NOT NULL,name TEXT NOT NULL,category TEXT NOT NULL,
 unit TEXT NOT NULL,pack_size TEXT NOT NULL,on_hand INTEGER NOT NULL,daily_usage REAL NOT NULL,
 suggested_reorder INTEGER NOT NULL,target_stock INTEGER NOT NULL,unit_cost REAL NOT NULL,
 shelf_life_days INTEGER,is_demo INTEGER NOT NULL DEFAULT 1,
 short_name TEXT NOT NULL DEFAULT '',reorder_level INTEGER NOT NULL DEFAULT 0,
 preferred_supplier_id TEXT NOT NULL DEFAULT '',keywords_json TEXT NOT NULL DEFAULT '[]',
 usage_known INTEGER NOT NULL DEFAULT 1,target_stock_known INTEGER NOT NULL DEFAULT 1,
 FOREIGN KEY(store_id) REFERENCES stores(id));
CREATE TABLE IF NOT EXISTS supplier_products(
 supplier_id TEXT NOT NULL,product_id TEXT NOT NULL,unit TEXT NOT NULL,
 pack_size TEXT NOT NULL,lead_days INTEGER NOT NULL,moq INTEGER NOT NULL,
 moq_known INTEGER NOT NULL DEFAULT 1,
 PRIMARY KEY(supplier_id,product_id),
 FOREIGN KEY(supplier_id) REFERENCES suppliers(id),FOREIGN KEY(product_id) REFERENCES products(id));
CREATE TABLE IF NOT EXISTS purchase_history(
 id INTEGER PRIMARY KEY AUTOINCREMENT,supplier_id TEXT NOT NULL,product_id TEXT NOT NULL,
 unit TEXT NOT NULL,pack_size TEXT NOT NULL,unit_price REAL NOT NULL,quantity INTEGER NOT NULL,
 purchase_date TEXT NOT NULL,is_demo INTEGER NOT NULL DEFAULT 1,
 UNIQUE(supplier_id,product_id,purchase_date));
CREATE TABLE IF NOT EXISTS sales_records(
 id INTEGER PRIMARY KEY AUTOINCREMENT,product_id TEXT NOT NULL,week_start TEXT NOT NULL,
 quantity INTEGER NOT NULL,is_demo INTEGER NOT NULL DEFAULT 1,
 UNIQUE(product_id,week_start));
CREATE TABLE IF NOT EXISTS rfqs(
 id TEXT PRIMARY KEY,store_id TEXT NOT NULL,product_id TEXT NOT NULL,
 quantity INTEGER NOT NULL,requested_delivery_date TEXT NOT NULL,actor TEXT NOT NULL,
 status TEXT NOT NULL,created_at TEXT NOT NULL,
 FOREIGN KEY(product_id) REFERENCES products(id));
CREATE TABLE IF NOT EXISTS rfq_suppliers(
 rfq_id TEXT NOT NULL,supplier_id TEXT NOT NULL,message TEXT NOT NULL,
 PRIMARY KEY(rfq_id,supplier_id));
CREATE TABLE IF NOT EXISTS quotes(
 id TEXT PRIMARY KEY,rfq_id TEXT NOT NULL,supplier_id TEXT NOT NULL,
 unit TEXT NOT NULL,pack_size TEXT NOT NULL,unit_price REAL NOT NULL,moq INTEGER NOT NULL,
 delivery_date TEXT NOT NULL,source TEXT NOT NULL,is_demo INTEGER NOT NULL,
 received_at TEXT NOT NULL,created_by TEXT NOT NULL,
 UNIQUE(rfq_id,supplier_id),
 FOREIGN KEY(rfq_id) REFERENCES rfqs(id));
CREATE TABLE IF NOT EXISTS purchase_orders(
 id TEXT PRIMARY KEY,po_number TEXT UNIQUE NOT NULL,store_id TEXT NOT NULL,
 product_id TEXT NOT NULL,supplier_id TEXT NOT NULL,rfq_id TEXT,quote_id TEXT,
 quantity INTEGER NOT NULL,unit TEXT NOT NULL,pack_size TEXT NOT NULL,
 unit_price REAL NOT NULL,total REAL NOT NULL,status TEXT NOT NULL,
 warnings TEXT NOT NULL,created_at TEXT NOT NULL,created_by TEXT NOT NULL,
 approved_by TEXT,approval_at TEXT,approval_notes TEXT,
 FOREIGN KEY(product_id) REFERENCES products(id));
CREATE TABLE IF NOT EXISTS activities(
 id INTEGER PRIMARY KEY AUTOINCREMENT,created_at TEXT NOT NULL,actor TEXT NOT NULL,
 action TEXT NOT NULL,product_id TEXT,supplier_id TEXT,rfq_id TEXT,po_id TEXT,
 status TEXT,details TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS app_meta(key TEXT PRIMARY KEY,value TEXT NOT NULL);
'''


def local_today():
    return datetime.now(ZoneInfo('Asia/Kuala_Lumpur')).date()


def now():
    return datetime.now(timezone.utc).isoformat(timespec='seconds').replace('+00:00','Z')


def money(x):
    return float(Decimal(str(x)).quantize(Decimal('0.01'),rounding=ROUND_HALF_UP))


def ensure_catalogue_columns(db):
    """Add catalogue metadata to existing SQLite files without rebuilding tables."""
    product_columns={row[1] for row in db.execute('PRAGMA table_info(products)')}
    for name,definition in (
        ('short_name',"TEXT NOT NULL DEFAULT ''"),
        ('reorder_level','INTEGER NOT NULL DEFAULT 0'),
        ('preferred_supplier_id',"TEXT NOT NULL DEFAULT ''"),
        ('keywords_json',"TEXT NOT NULL DEFAULT '[]'"),
        ('usage_known','INTEGER NOT NULL DEFAULT 1'),
        ('target_stock_known','INTEGER NOT NULL DEFAULT 1'),
    ):
        if name not in product_columns:
            db.execute(f'ALTER TABLE products ADD COLUMN {name} {definition}')
    supplier_columns={row[1] for row in db.execute('PRAGMA table_info(supplier_products)')}
    if 'moq_known' not in supplier_columns:
        db.execute('ALTER TABLE supplier_products ADD COLUMN moq_known INTEGER NOT NULL DEFAULT 1')


def new_id(prefix):
    return prefix+'-'+uuid.uuid4().hex[:12].upper()


def error(message, code, status):
    return jsonify({'error':{'code':code,'message':message},'status':status}),status


def parse_data():
    payload = request.get_json(silent=True)
    if not isinstance(payload,dict):
        raise ValueError('Expected JSON object body')
    return payload


def positive_int(value, label):
    if isinstance(value,bool) or not isinstance(value,int) or value<=0 or value>1000000:
        raise ValueError(f'{label} must be a positive whole number up to 1000000')
    return value


def price_decimal(value,label='unit_price'):
    if isinstance(value,bool) or value is None:
        raise ValueError(f'{label} must be a positive decimal amount')
    try:
        n = Decimal(str(value))
    except (ValueError,InvalidOperation):
        raise ValueError(f'{label} must be a positive decimal amount')
    if not n.is_finite() or n<=0 or n.as_tuple().exponent < -2 or n>Decimal('100000000'):
        raise ValueError(f'{label} must be positive, at most 2 decimals, and finite')
    return n


def valid_date(value,label,not_past=False):
    if not isinstance(value,str) or not re.fullmatch(r'\d{4}-\d{2}-\d{2}',value):
        raise ValueError(f'{label} must use YYYY-MM-DD')
    try:
        parsed = date.fromisoformat(value)
    except ValueError:
        raise ValueError(f'{label} must be a valid date')
    if not_past and parsed<local_today():
        raise ValueError(f'{label} cannot be in the past')
    return parsed


def actor_of(data):
    actor = data.get('actor','Owner')
    if not isinstance(actor,str) or not actor.strip() or len(actor)>80:
        raise ValueError('actor must be a nonempty string up to 80 characters')
    return actor.strip()


def one(sql, params=()):
    item=g.db.execute(sql,params).fetchone()
    return dict(item) if item else None


def many(sql, params=()):
    return [dict(x) for x in g.db.execute(sql,params).fetchall()]


def get_product(pid):
    return one('SELECT * FROM products WHERE id=?',(pid,))


def require_product(pid):
    p=get_product(pid)
    if not p:
        raise LookupError('Product not found')
    return p


def require_rfq(rid):
    r=one('SELECT * FROM rfqs WHERE id=?',(rid,))
    if not r:
        raise LookupError('Quotation request not found')
    return r


def require_po(pid):
    p=one('SELECT * FROM purchase_orders WHERE id=?',(pid,))
    if not p:
        raise LookupError('Purchase order not found')
    return p


def check_store(store_id):
    if store_id!=STORE_ID:
        raise LookupError('Store not found')


def append_activity(action, actor='Owner',product_id=None,supplier_id=None,rfq_id=None,po_id=None,status=None,details=None):
    g.db.execute('''INSERT INTO activities(created_at,actor,action,product_id,supplier_id,rfq_id,po_id,status,details)
        VALUES (?,?,?,?,?,?,?,?,?)''',(now(),actor,action,product_id,supplier_id,rfq_id,po_id,status,json.dumps(details or {})))


def product_public(p, detailed=False):
    rate=p['daily_usage'] if p['usage_known'] else None
    remaining=round(p['on_hand']/rate,2) if rate and rate>0 else None
    target_known=bool(p['target_stock_known'])
    excess=max(0,p['on_hand']-p['target_stock']) if target_known else None
    lead=one('SELECT lead_days FROM supplier_products WHERE product_id=? AND supplier_id=?',
             (p['id'],p['preferred_supplier_id']))
    weekly_rows=many('''SELECT quantity FROM sales_records WHERE product_id=?
                        ORDER BY week_start DESC LIMIT 2''',(p['id'],))
    weekly=({'previous_week':weekly_rows[1]['quantity'],'this_week':weekly_rows[0]['quantity']}
            if len(weekly_rows)>=2 else None)
    keywords=json.loads(p['keywords_json'] or '[]')
    expiry=(local_today()+timedelta(days=p['shelf_life_days'])).isoformat() if p['shelf_life_days'] is not None else None
    excess_cost=money(excess*p['unit_cost']) if excess is not None else None
    obj={
        'product_id':p['id'],'store_id':p['store_id'],'name':p['name'],'category':p['category'],
        'short_name':p['short_name'],'unit':p['unit'],'pack_size':p['pack_size'] or None,'on_hand':p['on_hand'],
        'daily_usage':rate,'estimated_days_until_stockout':remaining,
        'weekly_usage':weekly,'reorder_level':p['reorder_level'],
        'suggested_reorder_quantity':p['suggested_reorder'],
        'preferred_supplier_id':p['preferred_supplier_id'],
        'supplier_lead_time_days':lead['lead_days'] if lead else None,
        'last_purchase_price':p['unit_cost'],'reorder_reason':(
            'At or below reorder level' if p['on_hand']<=p['reorder_level'] else
            'May run out before supplier delivery' if remaining is not None and lead and remaining<=lead['lead_days'] else
            'Stock target is not configured' if not target_known else
            'Stock above target; review before ordering' if excess else 'Routine replenishment'),
        'excess_inventory_quantity':excess,'unit_cost_rm':p['unit_cost'],
        'estimated_excess_inventory_cost_rm':excess_cost,
        'shelf_life_days':p['shelf_life_days'],'expiry_date':expiry,'keywords':keywords,
        'data_source':'MINI_MART_DEMO' if p['is_demo'] else 'LIVE'
    }
    if detailed:
        obj['suppliers']=suppliers_for_product(p['id'], getattr(g, 'ngate_owner', None))
    return obj


def suppliers_for_product(pid, owner_id=None):
    owner_id = owner_id or getattr(g, 'ngate_owner', None)
    rows=many('''SELECT s.id AS supplier_id,s.name AS supplier_name,sp.lead_days,sp.moq,
            sp.moq_known,sp.unit,sp.pack_size FROM supplier_products sp JOIN suppliers s ON s.id=sp.supplier_id
            WHERE sp.product_id=?
            ORDER BY CASE WHEN sp.supplier_id=(SELECT preferred_supplier_id FROM products WHERE id=?) THEN 0 ELSE 1 END,s.name''',
            (pid,pid))
    by_supplier={}
    for row in rows:
        catalog_eligible=active_documented_supplier(pid,row['supplier_id'])
        reviewed=owner_verified_supplier_relationship(g.db,owner_id,pid,row['supplier_id'])
        if not catalog_eligible and not reviewed:
            continue
        if reviewed and not catalog_eligible:
            row['lead_days']=None
            row['moq']=None
            row['moq_known']=0
            row['unit']=g.db.execute('SELECT unit FROM products WHERE id=?',(pid,)).fetchone()['unit']
            row['pack_size']=None
        row['eligibility_source']='catalogue' if catalog_eligible else 'verified-reference'
        row['moq']=row['moq'] if row['moq_known'] else None
        row.pop('moq_known',None)
        row['pack_size']=row['pack_size'] or None
        by_supplier[row['supplier_id']]=row

    if owner_id:
        refs=g.db.execute('''SELECT DISTINCT r.supplier_id,r.payload FROM v5_price_references r
            WHERE r.owner_id=? AND r.product_id=? AND r.status IN ('verified','linked') AND r.supplier_id IS NOT NULL
            ORDER BY r.supplier_id''',
            (owner_id,pid)).fetchall()
        for ref in refs:
            sid=ref['supplier_id']
            if sid in by_supplier or not owner_verified_supplier_relationship(g.db,owner_id,pid,sid):
                continue
            master=master_supplier(sid)
            if not master:
                continue
            product_unit=g.db.execute('SELECT unit FROM products WHERE id=?',(pid,)).fetchone()['unit']
            line=json.loads(ref['payload'])
            by_supplier[sid]={
                'supplier_id':sid,'supplier_name':master['supplierName'],'lead_days':None,'moq':None,
                'unit':product_unit,'pack_size':None,'eligibility_source':'verified-reference',
            }
    return list(by_supplier.values())


def rfq_public(r):
    p=require_product(r['product_id'])
    dests=many('''SELECT rs.supplier_id,s.name AS supplier_name,rs.message
                FROM rfq_suppliers rs JOIN suppliers s ON s.id=rs.supplier_id
                WHERE rs.rfq_id=? ORDER BY s.name''',(r['id'],))
    obj={'rfq_id':r['id'],'store_id':r['store_id'],'product_id':r['product_id'],
         'product_name':p['name'],'unit':p['unit'],'pack_size':p['pack_size'],
         'quantity':r['quantity'],'requested_delivery_date':r['requested_delivery_date'],
         'status':r['status'],'created_at':r['created_at'],'actor':r['actor'],
         'suppliers':dests,'quotes':quotes_for_rfq(r['id']),
         'whatsapp_sent':False,'data_source':'DEMO_WORKSPACE'}
    return obj


def quotes_for_rfq(rid):
    rows = many('''SELECT q.id AS quote_id,q.rfq_id,q.supplier_id,s.name AS supplier_name,q.unit,
         q.pack_size,q.unit_price,q.moq,q.delivery_date,q.source,q.is_demo,q.received_at,q.created_by
         FROM quotes q JOIN suppliers s ON s.id=q.supplier_id WHERE q.rfq_id=? ORDER BY s.name''',(rid,))
    for item in rows:
        item['is_demo'] = bool(item['is_demo'])
    return rows


def po_public(po):
    item=dict(po)
    item['po_id']=item.pop('id')
    item['product_name']=require_product(item['product_id'])['name']
    item['supplier_name']=one('SELECT name FROM suppliers WHERE id=?',(item['supplier_id'],))['name']
    item['warnings']=json.loads(item['warnings'])
    item['currency']='MYR'
    item['sent_to_supplier']=False
    item['is_demo']=True
    return item


def create_app(test_config=None):
    app=Flask(__name__)
    app.config.update(DATABASE=str(ROOT/'instance'/'ngate.sqlite3'),TESTING=False)
    if test_config:
        app.config.update(test_config)
    install_service_security(app)
    app.register_blueprint(procurement_blueprint)
    allowed=[x.strip().rstrip('/') for x in os.getenv('FRONTEND_ORIGINS','http://localhost:5173,http://127.0.0.1:5173,http://localhost:3000').split(',') if x.strip()]

    @app.before_request
    def open_database():
        Path(app.config['DATABASE']).parent.mkdir(parents=True,exist_ok=True)
        g.db=sqlite3.connect(app.config['DATABASE'],timeout=15)
        g.db.row_factory=sqlite3.Row
        g.db.execute('PRAGMA foreign_keys=ON')
        g.db.execute('PRAGMA busy_timeout=15000')

    @app.teardown_request
    def close_database(exc):
        db=g.pop('db',None)
        if db is not None:
            db.close()

    @app.after_request
    def cors(resp):
        origin=request.headers.get('Origin','').rstrip('/')
        if origin in allowed:
            resp.headers['Access-Control-Allow-Origin']=origin
            resp.headers['Vary']='Origin'
            resp.headers['Access-Control-Allow-Methods']='GET,POST,PATCH,OPTIONS'
            resp.headers['Access-Control-Allow-Headers']='Content-Type'
        return resp

    @app.route('/api/<path:path>',methods=['OPTIONS'])
    def preflight(path):
        return Response(status=204)

    @app.errorhandler(ValueError)
    def bad_value(exc): return error(str(exc),'VALIDATION_ERROR',400)

    @app.errorhandler(LookupError)
    def not_found(exc): return error(str(exc),'NOT_FOUND',404)

    @app.errorhandler(404)
    def unknown_route(exc): return error('Endpoint not found','NOT_FOUND',404)

    @app.errorhandler(405)
    def bad_method(exc): return error('Method not allowed','METHOD_NOT_ALLOWED',405)

    @app.errorhandler(500)
    def server_error(exc): return error('Internal server error','INTERNAL_ERROR',500)

    @app.get('/')
    def root():
        return jsonify({'service':'NGate Backend','status':'running','demo_mode':True,'api_prefix':'/api','documentation':'README.md'})

    @app.get('/api/health')
    def health():
        return jsonify({'status':'ok','service':'NGate','database':'sqlite','demo_mode':True,'timestamp':now()})

    @app.get('/api/dashboard')
    def dashboard():
        check_store(request.args.get('store_id',STORE_ID))
        items=many('SELECT * FROM products ORDER BY name')
        public=[product_public(p,True) for p in items]
        growth=[]
        low_stock=[]
        for product in public:
            weekly=product['weekly_usage']
            if weekly and weekly['previous_week']>0:
                change=round((weekly['this_week']-weekly['previous_week'])/weekly['previous_week']*100,2)
                growth.append((change,product,weekly))
            lead=product['supplier_lead_time_days']
            cover=product['estimated_days_until_stockout']
            if product['on_hand']<=product['reorder_level'] or (cover is not None and lead is not None and cover<=lead):
                low_stock.append(product)
        sales=sorted(growth,key=lambda entry:(entry[0],entry[1]['name']),reverse=True)
        if sales:
            change,sales_product,weekly=sales[0]
            curr=weekly['this_week']
            prev=weekly['previous_week']
        else:
            change=None
            sales_product=None
            curr=prev=0
        sales_speed={
            'product_id':sales_product['product_id'] if sales_product else None,
            'product_name':sales_product['name'] if sales_product else None,
            'current_week_sales':curr,'previous_week_sales':prev,
            'percentage_change':change,
            'trend':'up' if change and change>0 else 'down' if change and change<0 else 'flat',
            'reason_bullets':[f'Sales increased {change:g}% week over week'] if change and change>0 else []
        }
        alerts=[]
        for product in low_stock:
            cover=product['estimated_days_until_stockout']
            lead=product['supplier_lead_time_days']
            reasons=[f'Only {product["on_hand"]} {product["unit"]}(s) in stock']
            if cover is not None:
                reasons.append(f'Estimated stockout in {cover:g} day(s)')
            if lead is not None:
                reasons.append(f'Preferred supplier lead time is {lead} day(s)')
            alerts.append({
                'alert_id':f'alert-{product["product_id"]}-low-stock',
                'type':'STOCKOUT_RISK','severity':'high' if cover is not None and lead is not None and cover<=lead else 'medium',
                'product_id':product['product_id'],'product_name':product['name'],
                'current_stock':product['on_hand'],
                'estimated_days_until_stockout':cover,
                'suggested_reorder_quantity':product['suggested_reorder_quantity'],
                'reason_bullets':reasons,
                'suggested_action':f'Request quotations for {product["suggested_reorder_quantity"]} {product["unit"]}(s)',
                'navigation':{'page':'Purchasing','product_id':product['product_id']}
            })
        lead_product=low_stock[0] if low_stock else (public[0] if public else None)
        preferred_lead=(
            next((s for s in lead_product['suppliers'] if s['supplier_id']==lead_product['preferred_supplier_id']),None)
            if lead_product else None
        )
        stock_money_alert=None
        overstocked=next((p for p in public if p['excess_inventory_quantity'] and p['excess_inventory_quantity']>0),None)
        if overstocked:
            stock_money_alert={
                'product_id':overstocked['product_id'],'product_name':overstocked['product_name'],
                'excess_quantity':overstocked['excess_inventory_quantity'],
                'unit_cost_rm':overstocked['unit_cost_rm'],
                'estimated_excess_inventory_cost_rm':overstocked['estimated_excess_inventory_cost_rm'],
                'reason_bullets':['Stock is above the configured target'],
                'suggested_action':'Pause replenishment and review demand'
            }
        return jsonify({
          'store_id':STORE_ID,'store_name':STORE_NAME,'currency':'MYR','data_source':'MINI_MART_DEMO',
          'sales_speed':sales_speed,
          'inventory_levels':[{'product_id':p['id'],'product_name':p['name'],
             'current_stock':p['on_hand'],'unit':p['unit'],
             'estimated_days_until_stockout':product_public(p)['estimated_days_until_stockout'],
             'suggested_reorder_quantity':p['suggested_reorder']} for p in items],
          'supplier_delivery_time':({
             'product_id':lead_product['product_id'],'product_name':lead_product['name'],
             'supplier_id':preferred_lead['supplier_id'],'supplier_name':preferred_lead['supplier_name'],
             'delivery_days':preferred_lead['lead_days']
          } if preferred_lead else None),
          'stock_money_alert':stock_money_alert,
          'alerts':alerts,'total_products':len(items)
        })

    @app.get('/api/products')
    def list_products():
        term=request.args.get('search','').strip().lower()
        check_store(request.args.get('store_id',STORE_ID))
        items=many('SELECT * FROM products WHERE store_id=? ORDER BY name',(STORE_ID,))
        if term:
            products=[p for p in items if term in p['name'].lower()
                      or term in p['short_name'].lower()
                      or any(term in keyword for keyword in json.loads(p['keywords_json'] or '[]'))]
            supplier_hits=[]
            for p in items:
                if p not in products and any(term in s['supplier_name'].lower() for s in suppliers_for_product(p['id'])):
                    supplier_hits.append(p)
            items=products+supplier_hits
        return jsonify({'products':[product_public(p) for p in items], 'count':len(items), 'data_source':'MINI_MART_DEMO'})

    @app.get('/api/products/<pid>')
    def product_detail(pid):
        return jsonify({'product':product_public(require_product(pid),True)})

    @app.get('/api/products/<pid>/purchases')
    def product_purchases(pid):
        p=require_product(pid)
        purchases=many('''SELECT ph.id AS purchase_id,ph.supplier_id,s.name AS supplier_name,
            ph.unit_price,ph.quantity,ph.unit,ph.pack_size,ph.purchase_date,ph.is_demo
            FROM purchase_history ph JOIN suppliers s ON s.id=ph.supplier_id
            WHERE ph.product_id=? ORDER BY ph.purchase_date DESC''',(pid,))
        for item in purchases:
            item['is_demo'] = bool(item['is_demo'])
        return jsonify({'product_id':pid,'product_name':p['name'],'purchases':purchases})

    @app.post('/api/quotation-requests')
    def create_rfq():
        data=parse_data()
        check_store(data.get('store_id',STORE_ID))
        p=require_product(data.get('product_id'))
        qty=positive_int(data.get('quantity'),'quantity')
        requested=valid_date(data.get('requested_delivery_date',local_today().isoformat()),'requested_delivery_date',True)
        ids=data.get('supplier_ids')
        if not isinstance(ids,list) or not ids or any(not isinstance(s,str) for s in ids) or len(ids)!=len(set(ids)):
            raise ValueError('supplier_ids must be a nonempty array of unique supplier IDs')
        chosen=[]
        for sid in ids:
            entry=one('''SELECT s.id AS supplier_id,s.name AS supplier_name FROM supplier_products sp
                 JOIN suppliers s ON s.id=sp.supplier_id WHERE sp.product_id=? AND sp.supplier_id=?''',(p['id'],sid))
            if not entry:
                raise ValueError(f'Supplier {sid} does not supply this product')
            chosen.append(entry)
        actor=actor_of(data)
        rid=new_id('RFQ')
        g.db.execute('''INSERT INTO rfqs VALUES(?,?,?,?,?,?,?,?)''',
                     (rid,STORE_ID,p['id'],qty,requested.isoformat(),actor,'DRAFT_READY',now()))
        pack_note=f' ({p["pack_size"]} per {p["unit"]})' if p['pack_size'] else ''
        for sp in chosen:
            # No WhatsApp phone numbers are invented. Frontend owns the open/copy action.
            message=(f'Hello {sp["supplier_name"]}, this is {STORE_NAME}. '
                     f'Please provide a quotation for {qty} {p["unit"]}(s) of {p["name"]}'
                     f'{pack_note}, requested delivery date {requested.isoformat()}. '
                     f'Please include unit price (RM), MOQ, and confirmed delivery date. Thank you!')
            g.db.execute('INSERT INTO rfq_suppliers VALUES(?,?,?)',(rid,sp['supplier_id'],message))
        append_activity('RFQ_PREPARED',actor,p['id'],rfq_id=rid,status='DRAFT_READY',details={'quantity':qty,'supplier_ids':ids,'whatsapp_sent':False})
        g.db.commit()
        return jsonify(rfq_public(require_rfq(rid))),201

    @app.get('/api/quotation-requests/<rid>')
    def get_rfq(rid):
        return jsonify(rfq_public(require_rfq(rid)))

    def insert_quote(rid,sid,p,price,moq,delivery,source,is_demo,actor):
        qid=new_id('Q')
        g.db.execute('''INSERT INTO quotes(id,rfq_id,supplier_id,unit,pack_size,unit_price,moq,
              delivery_date,source,is_demo,received_at,created_by) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)''',
              (qid,rid,sid,p['unit'],p['pack_size'],money(price),moq,delivery.isoformat(),source,int(is_demo),now(),actor))
        append_activity('QUOTE_SAMPLE_ADDED' if is_demo else 'QUOTE_RECEIVED',actor,p['id'],sid,rid,
                        status='SIMULATED' if is_demo else 'RECEIVED',details={'quote_id':qid,'unit_price':money(price),'is_demo':is_demo})
        return qid

    @app.post('/api/quotation-requests/<rid>/quotes')
    def create_quote(rid):
        r=require_rfq(rid)
        p=require_product(r['product_id'])
        data=parse_data()
        sid=data.get('supplier_id')
        if not one('SELECT 1 FROM rfq_suppliers WHERE rfq_id=? AND supplier_id=?',(rid,sid)):
            raise ValueError('supplier_id must be one of the RFQ selected suppliers')
        quoted_unit=data.get('unit')
        quoted_pack=data.get('pack_size')
        expected_pack=p['pack_size'] or None
        if quoted_unit!=p['unit'] or (quoted_pack or None)!=expected_pack:
            expected_label=f'{p["unit"]} / {expected_pack}' if expected_pack else f'{p["unit"]} / unspecified pack size'
            raise ValueError(f'Quote unit and pack_size must match {expected_label}; convert externally before comparing')
        price=price_decimal(data.get('unit_price'))
        moq=positive_int(data.get('moq'),'moq')
        delivery=valid_date(data.get('delivery_date'),'delivery_date')
        source=data.get('source','MANUAL')
        if source not in ['MANUAL','WHATSAPP_MANUAL','PDF_MANUAL','EXCEL_MANUAL']:
            raise ValueError('source must be MANUAL, WHATSAPP_MANUAL, PDF_MANUAL or EXCEL_MANUAL')
        if data.get('is_demo') is not False:
            raise ValueError('For real/manual replies set is_demo: false; use /demo-quotes for simulated replies')
        actor=actor_of(data)
        if one('SELECT 1 FROM quotes WHERE rfq_id=? AND supplier_id=?',(rid,sid)):
            return error('Quotation already exists for this RFQ and supplier','DUPLICATE_QUOTE',409)
        qid=insert_quote(rid,sid,p,price,moq,delivery,source,False,actor)
        g.db.commit()
        return jsonify({'quote':next(q for q in quotes_for_rfq(rid) if q['quote_id']==qid)}),201

    @app.post('/api/quotation-requests/<rid>/demo-quotes')
    def create_demo_quotes(rid):
        r=require_rfq(rid)
        p=require_product(r['product_id'])
        if p['id']!='premium-fragrant-rice':
            raise ValueError('Sample quotation scenario is only provided for Premium Fragrant Rice')
        if quotes_for_rfq(rid):
            return error('RFQ already contains quotes; cannot add demo set','QUOTES_ALREADY_EXIST',409)
        offer={'SUP-A':('12.50',20,2,'SAMPLE_PDF'),
               'SUP-B':('9.80',50,1,'SAMPLE_WHATSAPP'),
               'SUP-C':('10.50',20,1,'SAMPLE_EXCEL')}
        registered=many('SELECT supplier_id FROM rfq_suppliers WHERE rfq_id=?',(rid,))
        for item in registered:
            sid=item['supplier_id']
            if sid in offer:
                price,moq,lead,source=offer[sid]
                insert_quote(rid,sid,p,Decimal(price),moq,local_today()+timedelta(days=lead),source,True,'Demo Seeder')
        g.db.commit()
        return jsonify({'quotes':quotes_for_rfq(rid),'data_source':'DEMO_SIMULATED','note':'Generated sample replies only. No supplier was contacted.'}),201

    @app.get('/api/quotation-requests/<rid>/analysis')
    def quote_analysis(rid):
        r=require_rfq(rid)
        p=require_product(r['product_id'])
        quotes=quotes_for_rfq(rid)
        if not quotes:
            return error('No quotations recorded. Add a real reply or explicitly load sample replies.','NO_QUOTES',409)
        today=local_today()
        requested=date.fromisoformat(r['requested_delivery_date'])
        analyses=[]
        for q in quotes:
            historical=one('''SELECT unit_price FROM purchase_history
                 WHERE product_id=? AND supplier_id=? AND unit=? AND pack_size=?
                 ORDER BY purchase_date DESC,id DESC LIMIT 1''',(p['id'],q['supplier_id'],q['unit'],q['pack_size']))
            previous=historical['unit_price'] if historical else None
            delta=round((q['unit_price']-previous)/previous*100,2) if previous else None
            order_qty=max(r['quantity'],q['moq'])
            extra=order_qty-r['quantity']
            total=money(Decimal(str(order_qty))*Decimal(str(q['unit_price'])))
            extra_cost=money(Decimal(str(extra))*Decimal(str(q['unit_price'])))
            arrival=date.fromisoformat(q['delivery_date'])
            delivery_days=(arrival-today).days
            meet=arrival<=requested
            reasons=[]
            if previous is None:
                reasons.append('No previous price for the same supplier, unit and pack size')
            else:
                reasons.append(f'Last paid RM {previous:.2f} per {p["unit"]}')
                reasons.append(f'New quote RM {q["unit_price"]:.2f} per {p["unit"]}')
                reasons.append(f'Price change {delta:+.2f}%')
            if extra:
                reasons.append(f'MOQ {q["moq"]}: {extra} extra {p["unit"]}(s) add RM {extra_cost:.2f} inventory exposure')
            else:
                reasons.append(f'MOQ {q["moq"]}; no unnecessary extra quantity')
            reasons.append(f'Minimum purchase total RM {total:.2f}')
            reasons.append(f'Delivery in {delivery_days} day(s) on {q["delivery_date"]}')
            if not meet:
                reasons.append(f'After requested date {r["requested_delivery_date"]}; confirm or change date')
            if q['is_demo']:
                reasons.append('Simulated demo quotation — not a real supplier reply')
            risk=('high' if delta is not None and delta>=20 else 'medium' if extra else 'low')
            if not meet:
                risk='high' if risk=='high' else 'medium'
            label='Price went up' if delta is not None and delta>=20 else 'Must buy extra' if extra else 'Delivery date needs review' if not meet else 'Matches requested quantity'
            analyses.append({
                'supplier_id':q['supplier_id'],'supplier_name':q['supplier_name'],
                'quote_id':q['quote_id'],'quote_source':q['source'],'is_demo':bool(q['is_demo']),
                'unit':q['unit'],'pack_size':q['pack_size'],'unit_price':q['unit_price'],
                'previous_unit_price':previous,'price_change_percent':delta,
                'minimum_order_quantity':q['moq'],'requested_quantity':r['quantity'],
                'order_quantity_to_meet_moq':order_qty,'estimated_total':total,
                'extra_quantity':extra,'extra_inventory_cost':extra_cost,
                'delivery_days':delivery_days,'delivery_date':q['delivery_date'],
                'delivery_meets_requested_date':meet,'risk_level':risk,'risk_label':label,
                'reasons':reasons,'is_recommended':False
            })
        # Highest risk based on cost / excess and delivery, still allow owner to select any supplier.
        # The recommended supplier is lowest MINIMUM cash outlay among quotes that meet the date.
        # If none meets date, identify a conditional cheapest option with explicit delivery warning.
        suitable=[a for a in analyses if a['delivery_meets_requested_date']]
        candidates=suitable or analyses
        winner=min(candidates,key=lambda a:(a['estimated_total'],a['extra_quantity'],a['delivery_days'],a['supplier_id']))
        winner['is_recommended']=True
        highest=max(analyses,key=lambda a:(a['risk_level']=='high',a['extra_inventory_cost'],a['estimated_total']))
        if not one("SELECT 1 FROM activities WHERE action='SUPPLIER_COMPARISON_COMPLETED' AND rfq_id=?",(rid,)):
            append_activity('SUPPLIER_COMPARISON_COMPLETED','Owner',p['id'],rfq_id=rid,
                            details={'recommended_supplier_id':winner['supplier_id'],'quote_count':len(quotes)})
            g.db.commit()
        return jsonify({'rfq_id':rid,'product_id':p['id'],'product_name':p['name'],'unit':p['unit'],
              'pack_size':p['pack_size'],'requested_quantity':r['quantity'],
              'requested_delivery_date':r['requested_delivery_date'],
              'recommended_supplier_id':winner['supplier_id'],
              'recommendation_status':'MEETS_REQUESTED_DATE' if suitable else 'CONDITIONAL_DELIVERY_DATE',
              'recommendation_reasons':[f'Lowest minimum purchasing outlay RM {winner["estimated_total"]:.2f} among '+('on-time quotes' if suitable else 'available quotes'),
                                        'Owner must confirm supplier quality and delivery date'],
              'highest_risk_supplier_id':highest['supplier_id'],
              'highest_risk_reason':highest['risk_label'],
              'suppliers':sorted(analyses,key=lambda a:(not a['is_recommended'],a['estimated_total'])),
              'is_demo_data':all(q['is_demo'] for q in quotes),'currency':'MYR'})

    @app.post('/api/quotation-requests/<rid>/selection')
    def choose_supplier(rid):
        r=require_rfq(rid)
        data=parse_data()
        sid=data.get('supplier_id')
        if not one('SELECT 1 FROM rfq_suppliers WHERE rfq_id=? AND supplier_id=?',(rid,sid)):
            raise ValueError('Supplier must be selected in this RFQ')
        append_activity('SUPPLIER_SELECTED',actor_of(data),r['product_id'],sid,rid,details={'note':data.get('note','')})
        g.db.commit()
        return jsonify({'rfq_id':rid,'supplier_id':sid,'selection_recorded':True,'po_generated':False})

    @app.post('/api/purchase-orders/drafts')
    def create_po():
        data=parse_data()
        check_store(data.get('store_id',STORE_ID))
        p=require_product(data.get('product_id'))
        sid=data.get('supplier_id')
        sp=one('SELECT * FROM supplier_products WHERE supplier_id=? AND product_id=?',(sid,p['id']))
        if not sp:
            raise ValueError('Supplier does not supply this product')
        qty=positive_int(data.get('quantity'),'quantity')
        price=price_decimal(data.get('unit_price'))
        rid=data.get('rfq_id')
        quote_id=data.get('quote_id')
        quote=None
        if rid:
            rfq=require_rfq(rid)
            if rfq['product_id']!=p['id'] or not one('SELECT 1 FROM rfq_suppliers WHERE rfq_id=? AND supplier_id=?',(rid,sid)):
                raise ValueError('RFQ product or supplier does not match')
        if quote_id:
            if not rid:
                raise ValueError('rfq_id is required when quote_id is supplied')
            quote=one('SELECT * FROM quotes WHERE id=? AND rfq_id=? AND supplier_id=?',(quote_id,rid,sid))
            if not quote:
                raise ValueError('Quote does not match RFQ and supplier')
        moq=quote['moq'] if quote else (sp['moq'] if sp['moq_known'] else None)
        if moq is not None and qty<moq:
            raise ValueError(f'Quantity {qty} is below supplier MOQ {moq}')
        warnings=[]
        if not quote:
            warnings.append('No recorded supplier quote linked; manually verify unit price before approving')
            if moq is None:
                warnings.append('Supplier MOQ is not recorded; verify the minimum quantity manually')
        elif Decimal(str(quote['unit_price']))!=price:
            warnings.append(f'Edited unit price RM {money(price):.2f} differs from quoted RM {quote["unit_price"]:.2f}; confirm manually')
        if quote and date.fromisoformat(quote['delivery_date'])>local_today():
            if rid and quote['delivery_date']>require_rfq(rid)['requested_delivery_date']:
                warnings.append('Supplier delivery date is later than requested RFQ delivery date')
        actor=actor_of(data)
        pid=new_id('PO')
        po_number='NG-'+local_today().strftime('%Y%m%d')+'-'+uuid.uuid4().hex[:7].upper()
        total=money(Decimal(qty)*price)
        g.db.execute('''INSERT INTO purchase_orders(id,po_number,store_id,product_id,supplier_id,rfq_id,quote_id,
             quantity,unit,pack_size,unit_price,total,status,warnings,created_at,created_by)
             VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)''',
             (pid,po_number,STORE_ID,p['id'],sid,rid,quote_id,qty,p['unit'],p['pack_size'],money(price),total,
              'DRAFT_PENDING_APPROVAL',json.dumps(warnings),now(),actor))
        append_activity('PO_DRAFT_GENERATED',actor,p['id'],sid,rid,pid,'DRAFT_PENDING_APPROVAL',{'total':total,'warnings':warnings})
        g.db.commit()
        return jsonify({'purchase_order':po_public(require_po(pid))}),201

    @app.get('/api/purchase-orders')
    def list_pos():
        check_store(request.args.get('store_id',STORE_ID))
        pos=many('SELECT * FROM purchase_orders WHERE store_id=? ORDER BY created_at DESC,id DESC',(STORE_ID,))
        return jsonify({'purchase_orders':[po_public(p) for p in pos],'count':len(pos)})

    @app.get('/api/purchase-orders/<pid>')
    def get_po(pid):
        return jsonify({'purchase_order':po_public(require_po(pid))})

    @app.patch('/api/purchase-orders/<pid>/approval')
    def approve_po(pid):
        p=require_po(pid)
        if p['status']!='DRAFT_PENDING_APPROVAL':
            return error('This PO has already been reviewed','INVALID_STATUS',409)
        data=parse_data()
        choice=data.get('decision')
        if choice not in ('approve','reject'):
            raise ValueError('decision must be approve or reject')
        actor=actor_of(data)
        notes=data.get('notes','')
        if not isinstance(notes,str) or len(notes)>1000:
            raise ValueError('notes must be a string up to 1000 chars')
        status='APPROVED_NOT_SENT' if choice=='approve' else 'REJECTED'
        g.db.execute('''UPDATE purchase_orders SET status=?,approved_by=?,approval_at=?,approval_notes=? WHERE id=?''',
                     (status,actor,now(),notes,pid))
        append_activity('PO_APPROVED' if choice=='approve' else 'PO_REJECTED',actor,p['product_id'],p['supplier_id'],p['rfq_id'],pid,status,{'notes':notes,'sent':False})
        g.db.commit()
        return jsonify({'purchase_order':po_public(require_po(pid))})

    @app.get('/api/purchase-orders/<pid>/pdf')
    def po_pdf(pid):
        po=po_public(require_po(pid))
        stream=io.BytesIO()
        pdf=canvas.Canvas(stream,pagesize=A4)
        w,h=A4
        lines=[
           ('NGate - DRAFT PURCHASE ORDER',17),
           (STORE_NAME,12),
           (f'PO Number: {po["po_number"]}',11),
           (f'Date: {po["created_at"][:10]}',11),
           (f'Status: {po["status"]}',11),
           (f'Supplier: {po["supplier_name"]} ({po["supplier_id"]})',11),
           (f'Product: {po["product_name"]} ({po["product_id"]})',11),
           (f'Unit: {po["unit"]} / Pack size: {po["pack_size"] or "not recorded"}',11),
           (f'Quantity: {po["quantity"]}',11),
           (f'Unit Price: RM {po["unit_price"]:.2f}',11),
           (f'Total: RM {po["total"]:.2f}',13),
           ('',11),
           ('NOT SENT TO SUPPLIER - HUMAN APPROVAL REQUIRED',10),
           ('Hackathon demo data. Verify all purchasing details before any real use.',9)
        ]
        y=h-30*mm
        for line,size in lines:
            pdf.setFont('Helvetica-Bold' if size>=13 else 'Helvetica',size)
            pdf.drawString(20*mm,y,line)
            y-=9*mm
        for warning in po['warnings']:
            pdf.setFont('Helvetica',9)
            pdf.drawString(20*mm,y,('Warning: '+warning)[:110])
            y-=7*mm
        pdf.save()
        stream.seek(0)
        return send_file(stream,mimetype='application/pdf',as_attachment=True,download_name=po['po_number']+'.pdf')

    @app.get('/api/activity')
    def activity():
        check_store(request.args.get('store_id',STORE_ID))
        rows=many('SELECT * FROM activities ORDER BY id DESC LIMIT 500')
        for row in rows:
            row['activity_id']=row.pop('id')
            row['details']=json.loads(row['details'])
        return jsonify({'activity':rows,'count':len(rows)})

    with app.app_context():
        Path(app.config['DATABASE']).parent.mkdir(parents=True,exist_ok=True)
        db=sqlite3.connect(app.config['DATABASE'])
        db.executescript(SCHEMA)
        ensure_catalogue_columns(db)
        seed_database(db)
        migrate_procurement(db, app.config['DATABASE'])
        db.close()
    return app

app=create_app()

if __name__=='__main__':
    from preview_mount import mount_preview
    app.wsgi_app = mount_preview(app.wsgi_app, os.environ.get('BASE_PATH', ''))
    app.run(host=os.environ.get('NGATE_BIND_HOST','127.0.0.1'),port=int(os.environ.get('PORT','5000')),debug=False)
