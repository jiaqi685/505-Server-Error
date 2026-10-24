"""Mini Mart demo catalogue copied from the React seed; no live POS data."""
import json
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo
from supplier_master import MASTER, sync_verified_supplier_names

STORE_ID = "krukkruk"
STORE_NAME = "Krukkruk Mini Mart"
CATALOGUE_VERSION = "mini_mart_22_v1"

SUPPLIERS = [(s['supplierId'], s['supplierName']) for s in MASTER if s.get('active') is not False]

# Values mirror artifacts/ngate/src/data/seed.ts. Package size, supplier MOQ,
# and target stock are not present there, so they remain explicitly unknown.
PRODUCTS = [
    {"id":"premium-fragrant-rice","name":"Premium Fragrant Rice","short":"Fragrant Rice","category":"Rice & staples","unit":"bag","stock":3,"usage":3,"weekly":(18,21),"reorder":9,"suppliers":[("SUP-A",2),("SUP-B",1),("SUP-C",1)],"history":[("SUP-A",10,20,"2026-10-12"),("SUP-C",10.2,18,"2026-10-05"),("SUP-B",9.9,50,"2026-09-29"),("SUP-A",10,20,"2026-09-21")],"keywords":["beras","rice","wangi","fragrant"],"expires":180},
    {"id":"edible-cooking-oil","name":"Edible Cooking Oil","short":"Cooking Oil","category":"Rice & staples","unit":"bottle","stock":18,"usage":1,"weekly":(7,7),"reorder":4,"suppliers":[("SUP-A",3),("SUP-D",2)],"history":[("SUP-A",7.5,24,"2026-10-10"),("SUP-D",7.8,24,"2026-09-30")],"keywords":["minyak masak","oil","minyak"],"expires":240},
    {"id":"granulated-white-sugar","name":"Granulated White Sugar","short":"White Sugar","category":"Rice & staples","unit":"pack","stock":4,"usage":3,"weekly":(21,21),"reorder":8,"suppliers":[("SUP-A",2),("SUP-C",1)],"history":[("SUP-A",2.85,30,"2026-10-16"),("SUP-C",2.9,24,"2026-10-08")],"keywords":["gula","gula putih","sugar"]},
    {"id":"plain-wheat-flour","name":"Plain Wheat Flour","short":"Wheat Flour","category":"Rice & staples","unit":"pack","stock":12,"usage":2,"weekly":(14,14),"reorder":6,"suppliers":[("SUP-C",2),("SUP-A",2)],"history":[("SUP-C",3.2,24,"2026-10-16"),("SUP-A",3.4,24,"2026-10-08")],"keywords":["tepung","tepung gandum","flour"],"expires":150},
    {"id":"instant-noodles-5-pack","name":"5-Packet Instant Noodles","short":"Instant Noodles","category":"Noodles & canned food","unit":"pack","stock":5,"usage":4,"weekly":(24,28),"reorder":10,"suppliers":[("SUP-B",2),("SUP-D",1)],"history":[("SUP-B",4.5,30,"2026-10-17"),("SUP-D",4.8,24,"2026-10-10")],"keywords":["mi segera","mee","noodles","5 packet","5-packet"],"expires":180},
    {"id":"sardine-tomato-sauce","name":"Sardine in Tomato Sauce","short":"Sardines","category":"Noodles & canned food","unit":"can","stock":16,"usage":3,"weekly":(21,21),"reorder":8,"suppliers":[("SUP-B",2),("SUP-E",2)],"history":[("SUP-B",5.8,24,"2026-10-07"),("SUP-E",6,24,"2026-09-23")],"keywords":["sardin","sardine","tomato","canned fish"],"expires":365},
    {"id":"sweetened-creamer","name":"Sweetened Creamer Can","short":"Sweetened Creamer","category":"Milk & creamer","unit":"can","stock":14,"usage":3,"weekly":(21,21),"reorder":6,"suppliers":[("SUP-C",2),("SUP-E",2)],"history":[("SUP-C",3.4,24,"2026-10-07"),("SUP-E",3.6,24,"2026-09-23")],"keywords":["susu pekat","creamer","sweetened","condensed"],"expires":240},
    {"id":"soya-sauce-650ml","name":"Soya Sauce 650ml","short":"Soya Sauce","category":"Sauces & condiments","unit":"bottle","stock":8,"usage":1,"weekly":(7,7),"reorder":3,"suppliers":[("SUP-C",3),("SUP-D",3)],"history":[("SUP-C",5.9,12,"2026-10-02"),("SUP-D",6.2,12,"2026-09-18")],"keywords":["kicap","soy sauce","soya","650 ml"],"expires":300},
    {"id":"drinking-water","name":"Drinking Water","short":"Drinking Water","category":"Drinks","unit":"bottle","stock":20,"usage":4,"weekly":(14,28),"reorder":8,"suppliers":[("SUP-B",1),("SUP-C",2)],"history":[("SUP-B",0.85,48,"2026-10-15"),("SUP-C",0.9,48,"2026-10-01")],"keywords":["air minuman","mineral water","water"],"expires":365},
    {"id":"carbonated-drink","name":"Carbonated Drink","short":"Carbonated Drink","category":"Drinks","unit":"can","stock":24,"usage":5,"weekly":(35,35),"reorder":10,"suppliers":[("SUP-B",1),("SUP-E",2)],"history":[("SUP-B",1.6,48,"2026-10-14"),("SUP-E",1.7,48,"2026-10-06")],"keywords":["air gas","soda","soft drink","carbonated"],"expires":180},
    {"id":"original-uht-milk","name":"Original UHT Milk","short":"Original UHT Milk","category":"Milk & creamer","unit":"carton","stock":16,"usage":3,"weekly":(21,21),"reorder":6,"suppliers":[("SUP-B",1),("SUP-D",2)],"history":[("SUP-B",5.6,24,"2026-10-16"),("SUP-D",5.5,24,"2026-10-08"),("SUP-B",5.2,24,"2026-09-24")],"keywords":["susu","milk","uht","plain milk"],"expires":90},
    {"id":"coffee-instant-mix","name":"Coffee Instant Mix","short":"Instant Coffee","category":"Drinks","unit":"pack","stock":12,"usage":2,"weekly":(14,14),"reorder":5,"suppliers":[("SUP-A",2),("SUP-E",2)],"history":[("SUP-A",10.5,24,"2026-10-14"),("SUP-E",10.8,24,"2026-10-06")],"keywords":["kopi","coffee","instant","mix"],"expires":240},
    {"id":"cream-cracker-biscuits","name":"Cream Cracker Biscuits","short":"Cream Crackers","category":"Snacks & biscuits","unit":"pack","stock":12,"usage":2,"weekly":(14,14),"reorder":5,"suppliers":[("SUP-C",2),("SUP-E",2)],"history":[("SUP-C",4.2,24,"2026-10-14"),("SUP-E",4.4,24,"2026-10-06")],"keywords":["biskut","cream cracker","biscuits"],"expires":120},
    {"id":"potato-crisps","name":"Potato Crisps","short":"Potato Crisps","category":"Snacks & biscuits","unit":"pack","stock":18,"usage":4,"weekly":(28,28),"reorder":8,"suppliers":[("SUP-D",1),("SUP-E",2)],"history":[("SUP-D",2.8,36,"2026-10-17"),("SUP-E",3,36,"2026-10-09")],"keywords":["kerepek","potato chips","crisps","crips"],"expires":120},
    {"id":"strawberry-uht-milk","name":"Strawberry UHT Milk","short":"Strawberry Milk","category":"Milk & creamer","unit":"carton","stock":12,"usage":2,"weekly":(14,14),"reorder":5,"suppliers":[("SUP-B",1),("SUP-D",2)],"history":[("SUP-B",1.65,24,"2026-10-17"),("SUP-D",1.75,24,"2026-10-09")],"keywords":["susu strawberi","strawberry","strawbeerry","uht","uth","milk"],"expires":90},
    {"id":"chocolate-uht-milk","name":"Chocolate UHT Milk","short":"Chocolate Milk","category":"Milk & creamer","unit":"carton","stock":12,"usage":2,"weekly":(14,14),"reorder":5,"suppliers":[("SUP-B",1),("SUP-D",2)],"history":[("SUP-B",1.65,24,"2026-10-17"),("SUP-D",1.75,24,"2026-10-09")],"keywords":["susu coklat","chocolate","uht","uth","milk"],"expires":90},
    {"id":"laundry-detergent","name":"Laundry Detergent","short":"Laundry Detergent","category":"Household cleaning","unit":"bottle","stock":10,"usage":1,"weekly":(7,7),"reorder":3,"suppliers":[("SUP-A",3),("SUP-D",2)],"history":[("SUP-A",12.5,12,"2026-10-10"),("SUP-D",12.9,12,"2026-09-30")],"keywords":["sabun basuh","detergent laundry","laundry","detergent"]},
    {"id":"cleaner-liquid","name":"Cleaner Liquid","short":"Cleaner Liquid","category":"Household cleaning","unit":"bottle","stock":6,"usage":None,"weekly":None,"reorder":2,"suppliers":[("SUP-A",3),("SUP-D",3)],"history":[("SUP-A",6.5,12,"2026-10-04"),("SUP-D",6.8,12,"2026-09-20")],"keywords":["pencuci","cleaner","cleaning liquid"]},
    {"id":"bathroom-tissue","name":"Bathroom Tissue","short":"Bathroom Tissue","category":"Household essentials","unit":"pack","stock":12,"usage":2,"weekly":(14,14),"reorder":5,"suppliers":[("SUP-C",2),("SUP-A",2)],"history":[("SUP-C",8.5,24,"2026-10-11"),("SUP-A",8.9,24,"2026-09-27")],"keywords":["tisu","toilet paper","bathroom tissue","roll"]},
    {"id":"bath-soap","name":"Bath Soap","short":"Bath Soap","category":"Personal care","unit":"bar","stock":16,"usage":3,"weekly":(21,21),"reorder":6,"suppliers":[("SUP-D",2),("SUP-E",2)],"history":[("SUP-D",2.2,36,"2026-10-17"),("SUP-E",2.4,36,"2026-10-09")],"keywords":["sabun mandi","soap bath","bath soap"]},
    {"id":"toothpaste","name":"Toothpaste","short":"Toothpaste","category":"Personal care","unit":"tube","stock":12,"usage":2,"weekly":(14,14),"reorder":5,"suppliers":[("SUP-D",2),("SUP-E",2)],"history":[("SUP-D",4.5,24,"2026-10-17"),("SUP-E",4.8,24,"2026-10-09")],"keywords":["ubat gigi","toothpaste","dental"],"expires":365},
    {"id":"hair-shampoo","name":"Shampoo for Hair","short":"Hair Shampoo","category":"Personal care","unit":"bottle","stock":10,"usage":2,"weekly":(14,14),"reorder":4,"suppliers":[("SUP-D",2),("SUP-E",2)],"history":[("SUP-D",8.9,24,"2026-10-17"),("SUP-E",9.2,24,"2026-10-09")],"keywords":["syampu","shampoo","hair"]},
]


def seed_database(db):
    """Idempotently replace the previous demo catalogue once, transactionally."""
    expected_ids = {product["id"] for product in PRODUCTS}
    version = db.execute(
        "SELECT value FROM app_meta WHERE key='catalogue_version'"
    ).fetchone()
    active_ids = {
        row[0] for row in db.execute("SELECT id FROM products WHERE store_id=?", (STORE_ID,))
    }
    if version and version[0] == CATALOGUE_VERSION:
        if active_ids != expected_ids:
            raise RuntimeError("Mini Mart catalogue version is set but its product IDs do not match.")
        sync_verified_supplier_names(db)
        return

    db.execute("BEGIN IMMEDIATE")
    try:
        # A verified pre-migration SQLite backup retains all old demo records.
        for table in (
            "purchase_orders", "quotes", "rfq_suppliers", "rfqs", "activities",
            "purchase_history", "sales_records", "supplier_products", "products", "suppliers",
        ):
            db.execute(f'DELETE FROM "{table}"')
        db.execute("DELETE FROM stores")
        db.execute(
            "INSERT INTO stores(id,name) VALUES (?,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name",
            (STORE_ID, STORE_NAME),
        )
        db.executemany("INSERT INTO suppliers(id,name) VALUES (?,?)", SUPPLIERS)

        today = datetime.now(ZoneInfo("Asia/Kuala_Lumpur")).date()
        for product in PRODUCTS:
            history = product["history"]
            last_price = history[0][1]
            usage_known = product["usage"] is not None
            db.execute(
                """INSERT INTO products
                   (id,store_id,name,category,unit,pack_size,on_hand,daily_usage,
                    suggested_reorder,target_stock,unit_cost,shelf_life_days,is_demo,
                    short_name,reorder_level,preferred_supplier_id,keywords_json,
                    usage_known,target_stock_known)
                   VALUES (?,?,?,?,?,?,?,?,?,?,?,?,1,?,?,?,?,?,0)""",
                (
                    product["id"], STORE_ID, product["name"], product["category"],
                    product["unit"], "", product["stock"], product["usage"] or 0,
                    max(0, product["reorder"] - product["stock"]), 0, last_price,
                    product.get("expires"), product["short"], product["reorder"],
                    product["suppliers"][0][0],
                    json.dumps(product["keywords"], ensure_ascii=False),
                    int(usage_known),
                ),
            )
            for supplier_id, lead_days in product["suppliers"]:
                # MOQ and package size are not present in the frontend seed.
                db.execute(
                    """INSERT INTO supplier_products
                       (supplier_id,product_id,unit,pack_size,lead_days,moq,moq_known)
                       VALUES (?,?,?,?,?,?,0)""",
                    (supplier_id, product["id"], product["unit"], "", lead_days, 1),
                )
            for supplier_id, unit_price, quantity, purchase_date in history:
                db.execute(
                    """INSERT INTO purchase_history
                       (supplier_id,product_id,unit,pack_size,unit_price,quantity,purchase_date,is_demo)
                       VALUES (?,?,?,?,?,?,?,1)""",
                    (
                        supplier_id, product["id"], product["unit"], "",
                        unit_price, quantity, purchase_date,
                    ),
                )
            if product["weekly"]:
                previous, current = product["weekly"]
                for week_start, quantity in (
                    ((today - timedelta(days=7)).isoformat(), previous),
                    (today.isoformat(), current),
                ):
                    db.execute(
                        """INSERT INTO sales_records(product_id,week_start,quantity,is_demo)
                           VALUES (?,?,?,1)""",
                        (product["id"], week_start, quantity),
                    )

        db.execute(
            """INSERT INTO app_meta(key,value) VALUES ('catalogue_version',?)
               ON CONFLICT(key) DO UPDATE SET value=excluded.value""",
            (CATALOGUE_VERSION,),
        )
        db.commit()
    except Exception:
        db.rollback()
        raise
