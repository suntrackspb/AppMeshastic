import asyncio
import json
import logging
from datetime import datetime

import websockets

from .message_bus import bus
from ..data.models import Message
from ..data.repositories.messages import MessageRepository

logger = logging.getLogger(__name__)

_INTERNET_NODE_ID = "internet_bridge"
_RECONNECT_DELAY = 5  # seconds


class InternetBridge:
    """
    Connects to mesh-mirror-v2 WebSocket and feeds internet messages
    into the active node's message repository as source='internet'.
    """

    def __init__(self, url: str, msg_repo: MessageRepository) -> None:
        self._url = url
        self._msg_repo = msg_repo
        self._running = False
        self._task: asyncio.Task | None = None

    def start(self) -> None:
        self._running = True
        self._task = asyncio.create_task(self._run())

    def stop(self) -> None:
        self._running = False
        if self._task:
            self._task.cancel()

    def update_repo(self, msg_repo: MessageRepository) -> None:
        self._msg_repo = msg_repo

    async def _run(self) -> None:
        while self._running:
            try:
                await self._connect()
            except asyncio.CancelledError:
                break
            except Exception as e:
                logger.warning("InternetBridge disconnected: %s. Reconnecting in %ds", e, _RECONNECT_DELAY)
                await asyncio.sleep(_RECONNECT_DELAY)

    async def _connect(self) -> None:
        async with websockets.connect(self._url) as ws:
            logger.info("InternetBridge connected to %s", self._url)
            await bus.publish("internet_bridge.connected", {"url": self._url})
            async for raw in ws:
                await self._handle_raw(raw)

    async def _handle_raw(self, raw: str) -> None:
        try:
            data = json.loads(raw)
        except json.JSONDecodeError:
            return

        msg_type = data.get("type")

        if msg_type == "init":
            for item in data.get("messages", []):
                await self._save_message(item)
        elif msg_type == "new_message":
            await self._save_message(data.get("message", {}))

    async def _save_message(self, item: dict) -> None:
        if not item:
            return

        channel = item.get("channel", 0)
        to_id = str(item.get("to_id", "broadcast"))

        msg = Message(
            packet_id=item.get("packet_id"),
            from_node_id=str(item.get("from_id", "unknown")),
            to_node_id=to_id,
            contact_key=f"{channel}_{to_id}",
            channel=channel,
            text=item.get("text", ""),
            source="internet",
            status="received",
            received_at=datetime.utcnow(),
        )
        await self._msg_repo.save(msg)
        await bus.publish("message.new", {"node_id": _INTERNET_NODE_ID, "message": msg.to_dict()})
