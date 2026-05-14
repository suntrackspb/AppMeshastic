import os
import asyncio
import logging
from .base import AbstractConnection
from .channel_utils import read_channels, read_node_flags
from ..node_id_utils import normalize_node_id

logger = logging.getLogger(__name__)

_WATCHDOG_INTERVAL = 30  # seconds between port-alive checks


class SerialConnection(AbstractConnection):
    """Connection via USB serial port using meshtastic-python."""

    def __init__(self, port: str) -> None:
        self._port = port
        self._interface = None
        self._connected = False
        self._watchdog_task: asyncio.Task | None = None
        self._init_buffer()

    @property
    def is_connected(self) -> bool:
        return self._connected

    async def connect(self) -> None:
        self._loop = asyncio.get_event_loop()
        await self._loop.run_in_executor(None, self._connect_sync)
        self._watchdog_task = asyncio.create_task(self._watchdog())

    def _connect_sync(self) -> None:
        import meshtastic.serial_interface as mi
        from pubsub import pub

        self._interface = mi.SerialInterface(self._port)
        self.node_id = normalize_node_id(self._interface.myInfo.my_node_num)
        self.channels = read_channels(self._interface)
        self.node_flags = read_node_flags(self._interface)
        pub.subscribe(self._on_receive_sync, "meshtastic.receive")
        pub.subscribe(self._on_routing_sync, "meshtastic.receive.routing")
        self._connected = True

    async def _watchdog(self) -> None:
        """Periodically check if the serial port device is still present."""
        while self._connected:
            await asyncio.sleep(_WATCHDOG_INTERVAL)
            if not self._connected:
                break
            port_alive = os.path.exists(self._port)
            if not port_alive:
                logger.warning("watchdog: port %s disappeared, triggering disconnect", self._port)
                self._trigger_lost()
                break

    def _trigger_lost(self) -> None:
        """Called when connection is lost unexpectedly (cable unplug etc.)."""
        self._connected = False
        if self._on_disconnect:
            try:
                self._on_disconnect()
            except Exception:
                logger.exception("_trigger_lost: error in disconnect callback")

    def _on_receive_sync(self, packet: dict, interface) -> None:
        try:
            asyncio.run_coroutine_threadsafe(self._dispatch(packet), self._loop)
        except Exception:
            logger.exception("_on_receive_sync: error dispatching packet")
            self._trigger_lost()

    def _on_routing_sync(self, packet: dict, interface) -> None:
        try:
            asyncio.run_coroutine_threadsafe(self._dispatch(packet), self._loop)
        except Exception:
            logger.exception("_on_routing_sync: error dispatching packet")
            self._trigger_lost()

    async def disconnect(self) -> None:
        self._connected = False
        if self._watchdog_task and not self._watchdog_task.done():
            self._watchdog_task.cancel()
            try:
                await self._watchdog_task
            except asyncio.CancelledError:
                pass
        if self._interface:
            from pubsub import pub
            try:
                pub.unsubscribe(self._on_receive_sync, "meshtastic.receive")
                pub.unsubscribe(self._on_routing_sync, "meshtastic.receive.routing")
            except Exception:
                pass
            await self._loop.run_in_executor(None, self._interface.close)
            self._interface = None

    async def send_text(
        self, text: str, channel: int = 0, reply_to: int | None = None,
        destination_id: str = "^all",
    ) -> int | None:
        if not self._interface:
            return None
        packet = await self._loop.run_in_executor(
            None,
            lambda: self._interface.sendText(
                text, destinationId=destination_id, channelIndex=channel,
                replyId=reply_to, wantAck=True,
            ),
        )
        return packet.id if packet else None
