"""Authenticated internal transport; no browser-supplied identity is trusted."""
import hashlib
import hmac
import os
import threading
import time
from flask import g, jsonify, request


def install_service_security(app):
    seen = {}
    lock = threading.Lock()

    @app.before_request
    def authenticate_internal_request():
        if not request.path.startswith('/api/') or request.path == '/api/health':
            return None
        # Only the isolated legacy regression fixture opts into this. Never enabled by env.
        if app.testing and app.config.get('LEGACY_TEST_ACCESS') is True:
            return None
        secret = app.config.get('SERVICE_TEST_SECRET') if app.testing else None
        secret = secret or os.environ.get('SESSION_SECRET', '')
        if len(secret) < 32:
            return jsonify(error='Internal procurement authentication is not configured.'), 503
        owner = request.headers.get('X-NGate-Owner', '')
        stamp = request.headers.get('X-NGate-Time', '')
        nonce = request.headers.get('X-NGate-Nonce', '')
        key = request.headers.get('Idempotency-Key', '')
        signature = request.headers.get('X-NGate-Signature', '')
        if not owner or len(owner) > 200 or not nonce or len(nonce) > 100:
            return jsonify(error='Authenticated internal service request required.'), 401
        try:
            if abs(time.time() - int(stamp)) > 60:
                raise ValueError()
        except ValueError:
            return jsonify(error='Expired internal request.'), 401
        target = request.path + (('?' + request.query_string.decode('ascii')) if request.query_string else '')
        body_hash = hashlib.sha256(request.get_data(cache=True)).hexdigest()
        message = '\n'.join([request.method, target, owner, stamp, nonce, key, body_hash])
        service_key = hmac.new(secret.encode(), b'ngate-procurement-v2', hashlib.sha256).digest()
        expected = hmac.new(service_key, message.encode(), hashlib.sha256).hexdigest()
        if not hmac.compare_digest(signature, expected):
            return jsonify(error='Invalid internal service signature.'), 401
        with lock:
            now = time.time()
            for expired in [n for n, until in seen.items() if until < now]:
                del seen[expired]
            if nonce in seen:
                return jsonify(error='Internal request replay rejected.'), 409
            seen[nonce] = now + 120
        g.ngate_owner = owner
        # Legacy procurement is retained on disk, not reassigned/exposed to logins.
        catalogue_read = request.method == 'GET' and (request.path == '/api/products' or request.path.startswith('/api/products/'))
        if not request.path.startswith('/api/v2/procurement/') and not catalogue_read:
            return jsonify(error='Legacy unowned procurement routes are retired. Use authenticated v2 procurement.'), 410
