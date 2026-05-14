import asyncio
import logging
from abc import ABC, abstractmethod
from typing import Awaitable, Callable

logger = logging.getLogger(__name__)
PacketHandler = Callable[[dict], Awaitable[None]]


class AbstractConnection(ABC):
    """Interface for all node connection types (Serial, BLE, Wi-Fi)."""

    node_id: str | None = None
    channels: list[dict] = []

    def __init_subclass__(cls, **kwargs):
        super().__init_subclass__(**kwargs)

    def _init_buffer(self):
        self._on_packet: PacketHandler | None = None
        self._packet_buffer: list[dict] = []
        self._on_disconnect: Callable[[], None] | None = None

    def set_disconnect_callback(self, cb: Callable[[], None]) -> None:
        self._on_disconnect = cb

    @abstractmethod
    async def connect(self) -> None: ...

    @abstractmethod
    async def disconnect(self) -> None: ...

    @abstractmethod
    async def send_text(
        self, text: str, channel: int = 0, reply_to: int | None = None,
        destination_id: str = "^all",
    ) -> int | None:
        """Send a text message. Returns packet_id if available."""
        ...

    @property
    @abstractmethod
    def is_connected(self) -> bool: ...

    def set_packet_handler(self, handler: PacketHandler) -> None:
        self._on_packet = handler
        # drain packets that arrived before the handler was registered
        if hasattr(self, "_packet_buffer") and self._packet_buffer:
            import asyncio
            loop = getattr(self, "_loop", None) or asyncio.get_event_loop()
            for pkt in self._packet_buffer:
                asyncio.run_coroutine_threadsafe(self._on_packet(pkt), loop)
            self._packet_buffer.clear()

    def set_ack_handler(self, handler: Callable[[int, str], "Awaitable[None]"]) -> None:
        self._on_ack = handler

    async def request_user_info(self, dest_id: str) -> None:
        from meshtastic import portnums_pb2
        iface = self._interface
        loop = getattr(self, "_loop", None) or asyncio.get_event_loop()
        logger.debug("request_user_info dest=%s", dest_id)
        await loop.run_in_executor(
            None,
            lambda: iface.sendData(
                b"",
                destinationId=dest_id,
                portNum=portnums_pb2.PortNum.NODEINFO_APP,
                wantAck=False,
                wantResponse=True,
            ),
        )
        logger.info("request_user_info sent to %s", dest_id)

    async def send_traceroute(self, dest_id: str, hop_limit: int = 3) -> int | None:
        from meshtastic.protobuf import mesh_pb2
        from meshtastic import portnums_pb2
        iface = self._interface
        loop = getattr(self, "_loop", None) or asyncio.get_event_loop()
        logger.debug("send_traceroute dest=%s hop_limit=%d", dest_id, hop_limit)

        def _send():
            r = mesh_pb2.RouteDiscovery()
            return iface.sendData(
                r,
                destinationId=dest_id,
                portNum=portnums_pb2.PortNum.TRACEROUTE_APP,
                wantResponse=True,
                hopLimit=hop_limit,
            )

        packet = await loop.run_in_executor(None, _send)
        packet_id = packet.id if packet else None
        logger.info("send_traceroute sent to %s packet_id=%s", dest_id, packet_id)
        return packet_id

    async def set_favorite_node(self, dest_num: int, is_favorite: bool) -> None:
        from meshtastic.protobuf import admin_pb2
        iface = self._interface
        loop = getattr(self, "_loop", None) or asyncio.get_event_loop()
        logger.debug("set_favorite_node dest_num=%d is_favorite=%s", dest_num, is_favorite)

        def _send():
            msg = admin_pb2.AdminMessage()
            if is_favorite:
                msg.set_favorite_node = dest_num
            else:
                msg.remove_favorite_node = dest_num
            iface.localNode._sendAdmin(msg)

        await loop.run_in_executor(None, _send)
        logger.info("set_favorite_node sent dest_num=%d is_favorite=%s", dest_num, is_favorite)

    async def set_ignored_node(self, dest_num: int, is_ignored: bool) -> None:
        from meshtastic.protobuf import admin_pb2
        iface = self._interface
        loop = getattr(self, "_loop", None) or asyncio.get_event_loop()
        logger.debug("set_ignored_node dest_num=%d is_ignored=%s", dest_num, is_ignored)

        def _send():
            msg = admin_pb2.AdminMessage()
            if is_ignored:
                msg.set_ignored_node = dest_num
            else:
                msg.remove_ignored_node = dest_num
            iface.localNode._sendAdmin(msg)

        await loop.run_in_executor(None, _send)
        logger.info("set_ignored_node sent dest_num=%d is_ignored=%s", dest_num, is_ignored)

    async def remove_node(self, dest_num: int) -> None:
        from meshtastic.protobuf import admin_pb2
        iface = self._interface
        loop = getattr(self, "_loop", None) or asyncio.get_event_loop()
        logger.debug("remove_node dest_num=%d", dest_num)

        def _send():
            msg = admin_pb2.AdminMessage()
            msg.remove_by_nodenum = dest_num
            iface.localNode._sendAdmin(msg)

        await loop.run_in_executor(None, _send)
        logger.info("remove_node sent dest_num=%d", dest_num)

    async def get_device_config(self) -> dict:
        from google.protobuf.json_format import MessageToDict
        iface = self._interface
        loop = getattr(self, "_loop", None) or asyncio.get_event_loop()

        def _read():
            node = iface.localNode
            lc = node.localConfig
            node_entry = (iface.nodesByNum or {}).get(node.nodeNum, {})
            owner_info = node_entry.get("user", {})
            opts = dict(preserving_proto_field_name=True, always_print_fields_with_no_presence=True)
            mc = node.moduleConfig
            return {
                "owner": {
                    "long_name": owner_info.get("longName", ""),
                    "short_name": owner_info.get("shortName", ""),
                },
                "device": MessageToDict(lc.device, **opts),
                "lora": MessageToDict(lc.lora, **opts),
                "position": MessageToDict(lc.position, **opts),
                "power": MessageToDict(lc.power, **opts),
                "network": MessageToDict(lc.network, **opts),
                "display": MessageToDict(lc.display, **opts),
                "bluetooth": MessageToDict(lc.bluetooth, **opts),
                "security": MessageToDict(lc.security, **opts),
                "mqtt": MessageToDict(mc.mqtt, **opts),
            }

        return await loop.run_in_executor(None, _read)

    async def set_device_config(self, config: dict) -> None:
        from google.protobuf.json_format import ParseDict
        iface = self._interface
        loop = getattr(self, "_loop", None) or asyncio.get_event_loop()

        def _write():
            node = iface.localNode
            if "owner" in config:
                node.setOwner(
                    long_name=config["owner"].get("long_name") or None,
                    short_name=config["owner"].get("short_name") or None,
                )
            sections = ["device", "lora", "position", "power", "network", "display", "bluetooth", "security"]
            for section in sections:
                if section in config:
                    target = getattr(node.localConfig, section)
                    target.Clear()
                    ParseDict(config[section], target, ignore_unknown_fields=True)
                    node.writeConfig(section)
            if "mqtt" in config:
                target = node.moduleConfig.mqtt
                target.Clear()
                ParseDict(config["mqtt"], target, ignore_unknown_fields=True)
                node.writeConfig("mqtt")

        await loop.run_in_executor(None, _write)

    async def _dispatch(self, packet: dict) -> None:
        if not self._on_packet:
            # buffer until handler is set
            if hasattr(self, "_packet_buffer"):
                self._packet_buffer.append(packet)
            return
        try:
            logger.debug("Dispatching packet portnum=%s", packet.get("decoded", {}).get("portnum"))
            await self._on_packet(packet)
        except Exception:
            logger.exception("Error handling packet")
