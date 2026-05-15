import asyncio
import logging
import sys
import threading
import http.server
import socket
from pathlib import Path
from functools import partial

import webview

from .api import Api
from .core.node_manager import NodeManager
from . import updater
from . import __version__

_LOG_DIR = Path.home() / ".appmeshastic"
_LOG_DIR.mkdir(parents=True, exist_ok=True)

_fmt = logging.Formatter("%(asctime)s %(name)s %(levelname)s %(message)s")

# App log — only our modules (app.*)
_app_file = logging.FileHandler(_LOG_DIR / "app.log", encoding="utf-8")
_app_file.setFormatter(_fmt)
_app_stream = logging.StreamHandler()
_app_stream.setFormatter(_fmt)

app_logger = logging.getLogger("app")
app_logger.setLevel(logging.DEBUG)
app_logger.propagate = False
app_logger.addHandler(_app_file)
app_logger.addHandler(_app_stream)

# LoRa/meshtastic log — meshtastic + pubsub libraries
_lora_file = logging.FileHandler(_LOG_DIR / "lora.log", encoding="utf-8")
_lora_file.setFormatter(_fmt)

for _lib in ("meshtastic", "pubsub", "bleak"):
    _lib_logger = logging.getLogger(_lib)
    _lib_logger.setLevel(logging.DEBUG)
    _lib_logger.propagate = False
    _lib_logger.addHandler(_lora_file)

# Silence noisy stdlib loggers
logging.getLogger("asyncio").setLevel(logging.WARNING)
logging.getLogger("urllib3").setLevel(logging.WARNING)

logger = app_logger.getChild("main")
logger.info("App log: %s", _LOG_DIR / "app.log")
logger.info("LoRa log: %s", _LOG_DIR / "lora.log")

_FRONTEND_DIR = Path(__file__).parent / "frontend"


def _find_free_port() -> int:
    with socket.socket() as s:
        s.bind(("", 0))
        return s.getsockname()[1]


def _start_http_server(directory: Path, port: int) -> None:
    handler = partial(
        http.server.SimpleHTTPRequestHandler,
        directory=str(directory),
    )
    # Silence request logs — we have our own logging
    handler.log_message = lambda *a: None
    server = http.server.HTTPServer(("127.0.0.1", port), handler)
    logger.info("Frontend HTTP server started at http://127.0.0.1:%d", port)
    server.serve_forever()


def _start_asyncio_loop(loop: asyncio.AbstractEventLoop) -> None:
    asyncio.set_event_loop(loop)
    loop.run_forever()


def _set_macos_dock_icon() -> None:
    try:
        import AppKit
        import sys
        if getattr(sys, "frozen", False):
            base = Path(sys._MEIPASS)  # type: ignore[attr-defined]
        else:
            base = Path(__file__).parent.parent
        icon_path = base / "icon.png"
        if not icon_path.exists():
            return
        image = AppKit.NSImage.alloc().initWithContentsOfFile_(str(icon_path))
        if image:
            AppKit.NSApp.setApplicationIconImage_(image)
    except Exception:
        pass


def main() -> None:
    if sys.platform == "darwin":
        _set_macos_dock_icon()

    # 1. asyncio loop in background thread
    loop = asyncio.new_event_loop()
    asyncio_thread = threading.Thread(target=_start_asyncio_loop, args=(loop,), daemon=True)
    asyncio_thread.start()

    # 2. Background update check — notifies frontend via mesh event
    async def _check_update_later():
        await asyncio.sleep(3)  # wait for window to fully load
        result = await updater.check_for_update()
        if result:
            tag, url = result
            updater.pending_update = (tag, url)
            import json as _json
            payload = _json.dumps({"event": "update.available", "payload": {"version": tag}})
            if api._window:
                api._window.evaluate_js(f'window.__onMeshEvent && window.__onMeshEvent({payload})')

    loop.call_soon_threadsafe(lambda: asyncio.ensure_future(_check_update_later(), loop=loop))

    # 3. HTTP server for frontend (fixes ES module loading over file://)
    port = _find_free_port()
    http_thread = threading.Thread(
        target=_start_http_server, args=(_FRONTEND_DIR, port), daemon=True
    )
    http_thread.start()

    # 3. pywebview window
    node_manager = NodeManager()
    api = Api(node_manager, loop)

    window = webview.create_window(
        title=f"AppMeshastic v{__version__}",
        url=f"http://127.0.0.1:{port}/index.html",
        js_api=api,
        width=1100,
        height=720,
        min_size=(800, 500),
        background_color="#1c1c1e",
        easy_drag=False,
    )

    api.set_window(window)

    def _enable_text_selection():
        window.evaluate_js("""
            document.documentElement.style.webkitUserSelect = 'text';
            document.documentElement.style.userSelect = 'text';
            document.body.style.webkitUserSelect = 'text';
            document.body.style.userSelect = 'text';
        """)

    def _on_closing():
        """Disconnect all nodes before the window closes to release BLE/serial threads."""
        async def _shutdown():
            node_ids = node_manager.connected_node_ids()
            for nid in node_ids:
                try:
                    await asyncio.wait_for(node_manager.disconnect(nid), timeout=5)
                except Exception as e:
                    logger.warning("shutdown: error disconnecting %s: %s", nid, e)
            try:
                await asyncio.wait_for(node_manager.disconnect_mirror(), timeout=3)
            except Exception:
                pass

        future = asyncio.run_coroutine_threadsafe(_shutdown(), loop)
        try:
            future.result(timeout=10)
        except Exception as e:
            logger.warning("shutdown: _shutdown failed: %s", e)

    window.events.loaded += _enable_text_selection
    window.events.closing += _on_closing

    webview.start(debug=False)

    # Cleanup
    loop.call_soon_threadsafe(loop.stop)
    asyncio_thread.join(timeout=5)
    # Force-exit in case BLE/serial threads are still alive
    import os
    os._exit(0)


if __name__ == "__main__":
    main()


# TODO 
# 1. Добавить систему уведомлений глобальную. И через ней уведомлять о трейсроутах.
# 2. 
# 3. 
# 4. 
# 5. 