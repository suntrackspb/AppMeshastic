import asyncio
from .base import AbstractConnection
from .channel_utils import read_channels
from ..node_id_utils import normalize_node_id


class WiFiConnection(AbstractConnection):
    """Connection via TCP/IP (Wi-Fi or network) using meshtastic-python."""

    def __init__(self, host: str, port: int = 4403) -> None:
        self._host = host
        self._port = port
        self._interface = None
        self._connected = False
        self._init_buffer()

    @property
    def is_connected(self) -> bool:
        return self._connected

    async def connect(self) -> None:
        self._loop = asyncio.get_event_loop()
        await self._loop.run_in_executor(None, self._connect_sync)

    def _connect_sync(self) -> None:
        import meshtastic.tcp_interface as ti
        from pubsub import pub

        self._interface = ti.TCPInterface(self._host, portNumber=self._port)
        self.node_id = normalize_node_id(self._interface.myInfo.my_node_num)
        self.channels = read_channels(self._interface)
        pub.subscribe(self._on_receive_sync, "meshtastic.receive")
        pub.subscribe(self._on_routing_sync, "meshtastic.receive.routing")
        self._connected = True

    def _on_receive_sync(self, packet: dict, interface) -> None:
        asyncio.run_coroutine_threadsafe(self._dispatch(packet), self._loop)

    def _on_routing_sync(self, packet: dict, interface) -> None:
        asyncio.run_coroutine_threadsafe(self._dispatch(packet), self._loop)

    async def disconnect(self) -> None:
        if self._interface:
            from pubsub import pub
            try:
                pub.unsubscribe(self._on_receive_sync, "meshtastic.receive")
                pub.unsubscribe(self._on_routing_sync, "meshtastic.receive.routing")
            except Exception:
                pass
            await self._loop.run_in_executor(None, self._interface.close)
            self._interface = None
        self._connected = False

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
