import asyncio
import json
import logging
import ssl

logger = logging.getLogger(__name__)


class MirrorConnection:
    """WebSocket client to the mesh-mirror service."""

    def __init__(self, url: str, on_event) -> None:
        self._url = url
        self._on_event = on_event
        self._task: asyncio.Task | None = None
        self._running = False

    @property
    def url(self) -> str:
        return self._url

    async def connect(self) -> None:
        self._running = True
        self._task = asyncio.get_event_loop().create_task(self._run())

    async def disconnect(self) -> None:
        self._running = False
        if self._task:
            self._task.cancel()
            try:
                await self._task
            except asyncio.CancelledError:
                pass
            self._task = None

    async def _run(self) -> None:
        try:
            import websockets
        except ImportError:
            logger.error("websockets package not installed — cannot connect to mirror")
            return

        try:
            import certifi
            import sys, os
            # In a PyInstaller bundle certifi's cacert.pem is extracted to _MEIPASS/certifi/
            if getattr(sys, "frozen", False):
                cafile = os.path.join(sys._MEIPASS, "certifi", "cacert.pem")
            else:
                cafile = certifi.where()
            ssl_ctx = ssl.create_default_context(cafile=cafile)
        except ImportError:
            ssl_ctx = ssl.create_default_context()

        backoff = 1
        while self._running:
            try:
                ssl_arg = ssl_ctx if self._url.startswith("wss://") else None
                async with websockets.connect(self._url, ssl=ssl_arg) as ws:
                    logger.info("Mirror WS connected: %s", self._url)
                    backoff = 1
                    async for raw in ws:
                        if not self._running:
                            break
                        try:
                            data = json.loads(raw)
                            await self._on_event(data)
                        except Exception:
                            logger.exception("Error handling mirror event")
            except asyncio.CancelledError:
                break
            except Exception as exc:
                if not self._running:
                    break
                logger.warning("Mirror WS error: %s — reconnect in %ds", exc, backoff)
                await asyncio.sleep(backoff)
                backoff = min(backoff * 2, 30)

        logger.info("Mirror WS stopped")
