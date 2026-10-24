"""Mount the unchanged API paths under Replit's artifact prefix."""
from werkzeug.middleware.dispatcher import DispatcherMiddleware


def mount_preview(application, base_path):
    prefix = base_path.rstrip("/")
    if not prefix:
        return application
    if not prefix.startswith("/"):
        raise ValueError("BASE_PATH must begin with /")
    return DispatcherMiddleware(application, {prefix: application})
