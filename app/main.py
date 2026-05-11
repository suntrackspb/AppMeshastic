import asyncio
import logging
import threading
import http.server
import socket
from pathlib import Path
from functools import partial

import webview

from .api import Api
from .core.node_manager import NodeManager
from . import updater

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


def main() -> None:
    # 1. asyncio loop in background thread
    loop = asyncio.new_event_loop()
    asyncio_thread = threading.Thread(target=_start_asyncio_loop, args=(loop,), daemon=True)
    asyncio_thread.start()

    # 2. Background update check (non-blocking, fires after window is ready)
    async def _on_window_ready():
        result = await updater.check_for_update()
        if result:
            tag, url = result
            logger.info("Update available: %s", tag)
            # TODO: notify frontend to show update prompt, then call:
            # await updater.download_and_apply(tag, url)

    loop.call_soon_threadsafe(lambda: asyncio.ensure_future(_on_window_ready(), loop=loop))

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
        title="AppMeshastic",
        url=f"http://127.0.0.1:{port}/index.html",
        js_api=api,
        width=1100,
        height=720,
        min_size=(800, 500),
        background_color="#1c1c1e",
    )

    api.set_window(window)

    webview.start(debug=False)

    # Cleanup
    loop.call_soon_threadsafe(loop.stop)
    asyncio_thread.join(timeout=3)


if __name__ == "__main__":
    main()
