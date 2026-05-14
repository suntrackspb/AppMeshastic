import json
import asyncio
import logging
from datetime import datetime
from typing import Literal

logger = logging.getLogger(__name__)

from .connections.base import AbstractConnection
from .connections.serial_conn import SerialConnection
from .connections.ble_conn import BLEConnection
from .connections.wifi_conn import WiFiConnection
from .message_bus import bus
from .mirror_connection import MirrorConnection
from .node_id_utils import normalize_node_id
from ..data.node_store import init_db
from ..data.models import Message, Reaction
from ..data.repositories.messages import MessageRepository
from ..data.repositories.reactions import ReactionRepository
from ..data.repositories.nodes import NodeRepository
from ..data.repositories.traceroutes import TracerouteRepository

ConnectionType = Literal["serial", "ble", "wifi"]


def _is_emoji_only(text: str) -> bool:
    """True if text contains only emoji characters (no regular letters/digits)."""
    import unicodedata
    text = text.strip()
    if not text:
        return False
    for ch in text:
        cat = unicodedata.category(ch)
        # Allow emoji, combining marks, variation selectors, ZWJ
        if cat.startswith('L') or cat.startswith('N') or cat == 'Zs':
            return False
    return True


class NodeManager:
    """
    Manages lifecycle of node connections.
    Each connected node gets its own isolated DB and repositories.
    """

    def __init__(self) -> None:
        self._connections: dict[str, AbstractConnection] = {}
        self._conn_types: dict[str, str] = {}
        self._msg_repos: dict[str, MessageRepository] = {}
        self._react_repos: dict[str, ReactionRepository] = {}
        self._node_repos: dict[str, NodeRepository] = {}
        self._traceroute_repos: dict[str, TracerouteRepository] = {}
        self._active_node_id: str | None = None
        self._channels: dict[str, list[dict]] = {}
        self._mirror: MirrorConnection | None = None
        # packet_ids received via mirror (in-memory only, cleared on disconnect)
        self._mirror_packet_ids: set[int] = set()
        self._mirror_msg_id_to_packet_id: dict[int, int] = {}
        self._mirror_relay_counts: dict[int, int] = {}

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------

    async def connect(self, conn_type: ConnectionType, params: dict) -> str:
        conn = self._build_connection(conn_type, params)
        await conn.connect()

        node_id = conn.node_id
        await init_db(node_id)

        self._connections[node_id] = conn
        self._conn_types[node_id] = conn_type
        self._msg_repos[node_id] = MessageRepository(node_id)
        self._react_repos[node_id] = ReactionRepository(node_id)
        self._node_repos[node_id] = NodeRepository(node_id)
        self._traceroute_repos[node_id] = TracerouteRepository(node_id)
        self._channels[node_id] = conn.channels

        node_flags = getattr(conn, "node_flags", {})
        if node_flags:
            await self._node_repos[node_id].sync_flags(node_flags)
            logger.info("synced node flags from device: %d entries", len(node_flags))

        conn.set_packet_handler(self._make_packet_handler(node_id))

        loop = asyncio.get_event_loop()
        conn.set_disconnect_callback(
            lambda nid=node_id: asyncio.run_coroutine_threadsafe(
                self._on_connection_lost(nid), loop
            )
        )

        if not self._active_node_id:
            self._active_node_id = node_id

        await bus.publish("node.connected", {"node_id": node_id})
        return node_id

    async def disconnect(self, node_id: str) -> None:
        conn = self._connections.pop(node_id, None)
        if conn:
            await conn.disconnect()
        if node_id in self._msg_repos:
            await self._msg_repos[node_id].fail_pending(node_id)
        self._msg_repos.pop(node_id, None)
        self._react_repos.pop(node_id, None)
        self._node_repos.pop(node_id, None)
        self._traceroute_repos.pop(node_id, None)
        self._channels.pop(node_id, None)

        if self._active_node_id == node_id:
            self._active_node_id = next(iter(self._connections), None)

        await bus.publish("node.disconnected", {"node_id": node_id})

    async def _on_connection_lost(self, node_id: str) -> None:
        """Handle unexpected connection loss (cable unplug, port crash)."""
        if node_id not in self._connections:
            return  # already cleaned up
        logger.warning("connection lost for node_id=%s, cleaning up", node_id)
        self._connections.pop(node_id, None)
        if node_id in self._msg_repos:
            await self._msg_repos[node_id].fail_pending(node_id)
        self._msg_repos.pop(node_id, None)
        self._react_repos.pop(node_id, None)
        self._node_repos.pop(node_id, None)
        self._traceroute_repos.pop(node_id, None)
        self._channels.pop(node_id, None)

        if self._active_node_id == node_id:
            self._active_node_id = next(iter(self._connections), None)

        await bus.publish("node.disconnected", {"node_id": node_id, "reason": "lost"})

    def set_active(self, node_id: str) -> None:
        if node_id not in self._connections:
            raise ValueError(f"Node {node_id} not connected")
        self._active_node_id = node_id

    def get_active_node_id(self) -> str | None:
        return self._active_node_id

    def connected_node_ids(self) -> list[str]:
        return list(self._connections.keys())

    async def connected_nodes_info(self) -> list[dict]:
        result = []
        for node_id in self._connections:
            repo = self._node_repos.get(node_id)
            long_name = ""
            if repo:
                node = await repo.get(node_id)
                if node:
                    long_name = node.long_name or ""
            result.append({
                "node_id": node_id,
                "type": self._conn_types.get(node_id, ""),
                "long_name": long_name,
            })
        return result

    def get_channels(self, node_id: str) -> list[dict]:
        return self._channels.get(node_id, [{"index": 0, "name": "Primary", "role": "primary"}])

    def repos(self, node_id: str) -> tuple[MessageRepository, ReactionRepository, NodeRepository]:
        return self._msg_repos[node_id], self._react_repos[node_id], self._node_repos[node_id]

    async def send_text(
        self, node_id: str, text: str, channel: int = 0, reply_to: int | None = None,
        destination_id: str = "^all",
    ) -> int | None:
        conn = self._connections.get(node_id)
        if not conn:
            return None
        packet_id = await conn.send_text(text, channel, reply_to, destination_id)
        msg = Message(
            packet_id=packet_id,
            from_node_id=node_id,
            to_node_id=destination_id,
            contact_key=f"{channel}_{destination_id}",
            channel=channel,
            text=text,
            reply_to_packet_id=reply_to,
            source="radio",
            status="queued",
            sent_at=datetime.utcnow(),
        )
        msg.id = await self._msg_repos[node_id].save(msg)
        logger.debug("send_text publishing message.new packet_id=%s node_id=%s", packet_id, node_id)
        await bus.publish("message.new", {"node_id": node_id, "message": msg.to_dict()})
        logger.debug("send_text bus.publish done")
        asyncio.get_event_loop().create_task(
            self._ack_timeout(node_id, packet_id, timeout=60)
        )
        return packet_id

    async def send_reaction(
        self, node_id: str, emoji: str, reply_to: int, channel: int = 0, destination_id: str = "^all"
    ) -> None:
        # Save locally so it appears immediately without waiting for radio echo
        reaction = Reaction(message_packet_id=reply_to, from_node_id=node_id, emoji=emoji)
        await self._react_repos[node_id].save(reaction)
        await bus.publish("reaction.new", {"node_id": node_id, "reaction": reaction.to_dict()})
        # Standard Meshtastic reaction format: emoji text + reply_to
        await self._connections[node_id].send_text(emoji, channel, reply_to=reply_to, destination_id=destination_id)

    # ------------------------------------------------------------------
    # Node actions
    # ------------------------------------------------------------------

    async def request_user_info(self, node_id: str, dest_id: str) -> None:
        conn = self._connections.get(node_id)
        if not conn:
            logger.warning("request_user_info: no connection for node_id=%s", node_id)
            return
        logger.info("request_user_info node=%s dest=%s", node_id, dest_id)
        await conn.request_user_info(dest_id)

    async def send_traceroute(self, node_id: str, dest_id: str) -> int | None:
        conn = self._connections.get(node_id)
        if not conn:
            logger.warning("send_traceroute: no connection for node_id=%s", node_id)
            return None
        tr_repo = self._traceroute_repos.get(node_id)
        logger.info("send_traceroute node=%s dest=%s", node_id, dest_id)
        packet_id = await conn.send_traceroute(dest_id)
        if tr_repo and packet_id:
            await tr_repo.save_request(dest_id, packet_id)
            logger.debug("send_traceroute saved request packet_id=%s, starting timeout timer", packet_id)
            asyncio.ensure_future(self._traceroute_timeout(tr_repo, packet_id, dest_id))
        elif not packet_id:
            logger.warning("send_traceroute: got no packet_id from interface, cannot track result")
        return packet_id

    async def _traceroute_timeout(self, tr_repo, request_id: int, dest_id: str, timeout: float = 300) -> None:
        await asyncio.sleep(timeout)
        logger.warning("traceroute timeout reached request_id=%s dest=%s", request_id, dest_id)
        await tr_repo.timeout_request(request_id)
        await bus.publish("traceroute.timeout", {"request_id": request_id, "dest_node_id": dest_id})

    async def set_node_favorite(self, node_id: str, dest_id: str, value: bool) -> None:
        conn = self._connections.get(node_id)
        node_repo = self._node_repos.get(node_id)
        logger.info("set_node_favorite node=%s dest=%s value=%s", node_id, dest_id, value)
        if conn:
            dest_num = _node_id_to_num(dest_id)
            await conn.set_favorite_node(dest_num, value)
        if node_repo:
            await node_repo.set_favorite(dest_id, value)
            logger.debug("set_node_favorite saved to DB dest=%s", dest_id)

    async def set_node_ignored(self, node_id: str, dest_id: str, value: bool) -> None:
        conn = self._connections.get(node_id)
        node_repo = self._node_repos.get(node_id)
        logger.info("set_node_ignored node=%s dest=%s value=%s", node_id, dest_id, value)
        if conn:
            dest_num = _node_id_to_num(dest_id)
            await conn.set_ignored_node(dest_num, value)
        if node_repo:
            await node_repo.set_ignored(dest_id, value)
            logger.debug("set_node_ignored saved to DB dest=%s", dest_id)

    async def delete_node(self, node_id: str, dest_id: str) -> None:
        conn = self._connections.get(node_id)
        node_repo = self._node_repos.get(node_id)
        logger.info("delete_node node=%s dest=%s", node_id, dest_id)
        if conn:
            dest_num = _node_id_to_num(dest_id)
            await conn.remove_node(dest_num)
        if node_repo:
            await node_repo.delete_node(dest_id)
            logger.debug("delete_node removed from DB dest=%s", dest_id)

    # ------------------------------------------------------------------
    # Mirror (mesh-mirror WebSocket bridge)
    # ------------------------------------------------------------------

    async def connect_mirror(self, url: str) -> None:
        if self._mirror:
            await self._mirror.disconnect()
        self._mirror_packet_ids.clear()
        self._mirror_msg_id_to_packet_id.clear()
        self._mirror_relay_counts.clear()
        self._mirror = MirrorConnection(url, self._handle_mirror_event)
        await self._mirror.connect()
        await bus.publish("mirror.connected", {"url": url})

    async def disconnect_mirror(self) -> None:
        if self._mirror:
            await self._mirror.disconnect()
            self._mirror = None
        self._mirror_packet_ids.clear()
        self._mirror_msg_id_to_packet_id.clear()
        self._mirror_relay_counts.clear()
        await bus.publish("mirror.disconnected", {})

    def mirror_status(self) -> dict:
        return {
            "connected": self._mirror is not None,
            "url": self._mirror.url if self._mirror else None,
        }

    async def _handle_mirror_event(self, data: dict) -> None:
        msg_type = data.get("type")
        if msg_type == "init":
            # Show last 100 historical messages to avoid flooding
            messages = data.get("messages", [])[-100:]
            for msg_data in messages:
                await self._process_mirror_message(msg_data)
        elif msg_type == "new_message":
            await self._process_mirror_message(data.get("message", {}))
        elif msg_type == "relay_update":
            mirror_msg_id = data.get("message_id")
            packet_id = self._mirror_msg_id_to_packet_id.get(mirror_msg_id)
            if packet_id is not None:
                self._mirror_relay_counts[packet_id] = self._mirror_relay_counts.get(packet_id, 0) + 1
                await bus.publish("relay.update", {
                    "packet_id": packet_id,
                    "relay_count": self._mirror_relay_counts[packet_id],
                    "mirror_msg_id": mirror_msg_id,
                })

    async def _process_mirror_message(self, msg_data: dict) -> None:
        packet_id = msg_data.get("packet_id")
        text = msg_data.get("text", "").strip()
        from_id = msg_data.get("from_id", "")

        if not packet_id or not text or not from_id:
            return

        reply_to = msg_data.get("reply_to_packet_id")
        node_id = self._active_node_id or "mirror"

        channel_name = (msg_data.get("channel") or "").lower()
        # LongFast is the Meshtastic default name for the Primary (index 0) channel.
        # The local node names it "Primary", so we treat them as the same.
        PRIMARY_NAMES = {"longfast", "lf", "primary", ""}
        channel_index = 0
        node_channels = self._channels.get(node_id) if node_id != "mirror" else None
        if node_channels and channel_name not in PRIMARY_NAMES:
            # Try to match secondary channel by name; skip if not configured on this node.
            matched = False
            for ch in node_channels:
                if ch.get("name", "").lower() == channel_name:
                    channel_index = ch.get("index", 0)
                    matched = True
                    break
            if not matched:
                return

        # Reaction: emoji-only reply
        if reply_to and _is_emoji_only(text):
            reaction = Reaction(
                message_packet_id=reply_to,
                from_node_id=from_id,
                emoji=text,
            )
            await bus.publish("reaction.new", {"node_id": node_id, "reaction": reaction.to_dict()})
            return

        received_at_str = msg_data.get("received_at") or msg_data.get("sent_at")
        try:
            received_at = datetime.fromisoformat(
                received_at_str.replace("Z", "+00:00")
            ).replace(tzinfo=None) if received_at_str else datetime.utcnow()
        except Exception:
            received_at = datetime.utcnow()

        msg = Message(
            packet_id=packet_id,
            from_node_id=from_id,
            to_node_id=msg_data.get("to_id") or "^all",
            contact_key=f"{channel_index}_^all",
            channel=channel_index,
            text=text,
            reply_to_packet_id=reply_to,
            source="mirror",
            status="received",
            received_at=received_at,
            snr=msg_data.get("snr"),
        )

        mirror_msg_id = msg_data.get("id")
        relays = msg_data.get("relays") or []
        if isinstance(relays, str):
            try:
                relays = json.loads(relays)
            except Exception:
                relays = []
        if mirror_msg_id:
            self._mirror_msg_id_to_packet_id[mirror_msg_id] = packet_id
            self._mirror_relay_counts[packet_id] = len(relays)

        self._mirror_packet_ids.add(packet_id)
        await bus.publish("message.new", {"node_id": node_id, "message": msg.to_dict()})
        if mirror_msg_id is not None:
            await bus.publish("relay.info", {
                "packet_id": packet_id,
                "mirror_msg_id": mirror_msg_id,
                "relay_count": len(relays),
            })

    # ------------------------------------------------------------------
    # Internal
    # ------------------------------------------------------------------

    def _build_connection(self, conn_type: ConnectionType, params: dict) -> AbstractConnection:
        match conn_type:
            case "serial":
                return SerialConnection(params["port"])
            case "ble":
                return BLEConnection(params["address"])
            case "wifi":
                return WiFiConnection(params["host"], params.get("port", 4403))
            case _:
                raise ValueError(f"Unknown connection type: {conn_type}")

    def _make_packet_handler(self, node_id: str):
        async def handle(packet: dict) -> None:
            await self._process_packet(node_id, packet)
        return handle

    async def _process_packet(self, node_id: str, packet: dict) -> None:
        decoded = packet.get("decoded", {})
        port_num = decoded.get("portnum", "")
        packet_id = packet.get("id")

        logger.debug("process_packet portnum=%s node=%s", port_num, node_id)

        if port_num == "ROUTING_APP":
            request_id = decoded.get("requestId")
            if request_id:
                routing = decoded.get("routing", {})
                error = routing.get("errorReason", "NONE")
                await self._handle_routing_ack(node_id, request_id, error)
            return

        # Relay detection fallback: hear own packet retransmitted by another node
        if packet_id and port_num == "TEXT_MESSAGE_APP":
            from_id = packet.get("fromId") or ""
            from_id_norm = normalize_node_id(from_id) if from_id else ""
            if from_id_norm != node_id:
                await self._try_mark_relayed(node_id, packet_id)

        if port_num == "TEXT_MESSAGE_APP":
            await self._handle_text(node_id, packet, decoded)
        elif port_num in ("POSITION_APP", "TELEMETRY_APP", "USER_APP", "NODEINFO_APP"):
            await self._handle_node_info(node_id, packet, decoded)
        elif port_num == "TRACEROUTE_APP":
            await self._handle_traceroute(node_id, packet, decoded)

    async def _handle_text(self, node_id: str, packet: dict, decoded: dict) -> None:
        text = decoded.get("text", "")
        from_id = normalize_node_id(packet.get("fromId") or packet.get("from", ""))
        to_id = packet.get("toId") or "^all"
        channel = packet.get("channel", 0)
        logger.info("handle_text from=%s to=%s text=%r", from_id, to_id, text[:80])
        packet_id = packet.get("id")

        # Reaction: emoji-only reply (standard Meshtastic format)
        reply_id = decoded.get("replyId")
        if reply_id and _is_emoji_only(text):
            reaction = Reaction(
                message_packet_id=reply_id,
                from_node_id=from_id,
                emoji=text,
            )
            await self._react_repos[node_id].save(reaction)
            await bus.publish("reaction.new", {"node_id": node_id, "reaction": reaction.to_dict()})
            return

        # Group conversation by the other party:
        # - broadcast → _^all
        # - DM to us → use from_id (sender)
        # - DM we sent (echo) → use to_id (recipient)
        if to_id == "^all":
            contact_key = f"{channel}_^all"
        elif to_id == node_id:
            contact_key = f"{channel}_{from_id}"
        else:
            contact_key = f"{channel}_{to_id}"
        hop_start = packet.get("hopStart", 0)
        hop_limit = packet.get("hopLimit", 0)
        received_at = datetime.utcnow()
        msg = Message(
            packet_id=packet_id,
            from_node_id=from_id,
            to_node_id=to_id,
            contact_key=contact_key,
            channel=channel,
            text=text,
            reply_to_packet_id=decoded.get("replyId"),
            source="radio",
            status="received",
            received_at=received_at,
            hops_away=hop_start - hop_limit if hop_start else None,
            snr=packet.get("rxSnr"),
            rssi=packet.get("rxRssi"),
        )
        msg.id = await self._msg_repos[node_id].save(msg)
        logger.debug("handle_text saved msg id=%s packet_id=%s", msg.id, packet_id)
        await self._touch_node(node_id, packet)
        await bus.publish("message.new", {"node_id": node_id, "message": msg.to_dict()})

    async def _handle_routing_ack(self, node_id: str, request_id: int, error_reason: str) -> None:
        repo = self._msg_repos.get(node_id)
        if not repo:
            return
        is_ack = error_reason in ("NONE", "")
        new_status = "delivered" if is_ack else "error"
        async with __import__("aiosqlite").connect(repo._db) as db:
            row = await db.execute_fetchall(
                "SELECT id FROM messages WHERE packet_id = ? AND from_node_id = ? AND status IN ('queued','enroute')",
                (request_id, node_id),
            )
        if row:
            logger.debug("routing_ack packet_id=%s node=%s error=%s → %s", request_id, node_id, error_reason, new_status)
            await repo.update_status(request_id, new_status)
            await bus.publish("message.ack", {"node_id": node_id, "packet_id": request_id, "status": new_status})

    async def _ack_timeout(self, node_id: str, packet_id: int, timeout: float = 60) -> None:
        await asyncio.sleep(timeout)
        repo = self._msg_repos.get(node_id)
        if not repo:
            return
        async with __import__("aiosqlite").connect(repo._db) as db:
            row = await db.execute_fetchall(
                "SELECT id FROM messages WHERE packet_id = ? AND from_node_id = ? AND status IN ('queued','enroute')",
                (packet_id, node_id),
            )
        if row:
            logger.debug("ack_timeout packet_id=%s node=%s → delivered (no ack received)", packet_id, node_id)
            await repo.update_status(packet_id, "delivered")
            await bus.publish("message.ack", {"node_id": node_id, "packet_id": packet_id, "status": "delivered"})

    async def _try_mark_relayed(self, node_id: str, packet_id: int) -> None:
        repo = self._msg_repos.get(node_id)
        if not repo:
            return
        async with __import__("aiosqlite").connect(repo._db) as db:
            row = await db.execute_fetchall(
                "SELECT id FROM messages WHERE packet_id = ? AND from_node_id = ? AND status IN ('queued','enroute')",
                (packet_id, node_id),
            )
        if row:
            logger.debug("relay ack packet_id=%s node=%s → delivered", packet_id, node_id)
            await repo.update_status(packet_id, "delivered")
            await bus.publish("message.ack", {"node_id": node_id, "packet_id": packet_id, "status": "delivered"})

    async def _handle_traceroute(self, node_id: str, packet: dict, decoded: dict) -> None:
        request_id = decoded.get("requestId") or packet.get("id")
        # meshtastic-python uses "traceroute" key (newer) or "routeDiscovery" (older)
        tr = decoded.get("traceroute") or decoded.get("routeDiscovery") or {}
        dest_id = normalize_node_id(packet.get("fromId") or packet.get("from", ""))
        # intermediate nodes (empty for direct hops); build full path with endpoints
        intermediate_fwd = [normalize_node_id(n) for n in tr.get("route", [])]
        intermediate_back = [normalize_node_id(n) for n in tr.get("routeBack", [])]
        snr_fwd = tr.get("snrTowards", [])
        snr_back = tr.get("snrBack", [])

        def build_route(src: str, dst: str, intermediates: list, snrs: list) -> list[dict]:
            nodes = [src] + intermediates + [dst]
            route = []
            for i, nid in enumerate(nodes):
                snr = snrs[i] / 4.0 if i < len(snrs) else None  # snr encoded as x4
                route.append({"node_id": nid, "snr": snr})
            return route

        forward_route = build_route(node_id, dest_id, intermediate_fwd, snr_fwd)
        return_route = build_route(dest_id, node_id, intermediate_back, snr_back)

        tr_repo = self._traceroute_repos.get(node_id)
        if tr_repo and request_id:
            await tr_repo.complete(request_id, forward_route, return_route)

        await self._touch_node(node_id, packet)
        await bus.publish("traceroute.result", {
            "node_id": node_id,
            "request_id": request_id,
            "dest_node_id": dest_id,
            "forward_route": forward_route,
            "return_route": return_route,
        })

    async def _touch_node(self, node_id: str, packet: dict) -> None:
        """Upsert a minimal node record so the node appears in the list even before NodeInfo arrives."""
        from ..data.models import Node
        repo = self._node_repos.get(node_id)
        if not repo:
            return
        from_id = normalize_node_id(packet.get("fromId") or packet.get("from", ""))
        if not from_id or from_id == node_id:
            return
        node = Node(
            node_id=from_id,
            last_seen_at=datetime.utcnow(),
            snr=packet.get("rxSnr"),
            rssi=packet.get("rxRssi"),
            hops_away=packet.get("hopStart", 0) - packet.get("hopLimit", 0) or None,
            via_mqtt=packet.get("viaMqtt", False),
        )
        await repo.save(node)
        logger.debug("touch_node from=%s via packet portnum=%s", from_id, packet.get("decoded", {}).get("portnum"))
        full_node = await repo.get(from_id)
        await bus.publish("node.updated", {"node_id": node_id, "node": (full_node or node).to_dict()})

    async def _handle_node_info(self, node_id: str, packet: dict, decoded: dict) -> None:
        from ..data.models import Node

        from_id = normalize_node_id(packet.get("fromId") or packet.get("from", ""))
        node = Node(node_id=from_id, last_seen_at=datetime.utcnow())

        user = decoded.get("user", {})
        if user:
            node.long_name = user.get("longName", "")
            node.short_name = user.get("shortName", "")
            node.hw_model = user.get("hwModel", "")
            node.role = user.get("role", "")
            if user.get("publicKey"):
                node.public_key = user["publicKey"]

        pos = decoded.get("position", {})
        if pos:
            node.latitude = pos.get("latitudeI", 0) / 1e7 or None
            node.longitude = pos.get("longitudeI", 0) / 1e7 or None
            node.altitude = pos.get("altitude")

        telemetry = decoded.get("deviceMetrics", {})
        if telemetry:
            node.battery_level = telemetry.get("batteryLevel")

        node.snr = packet.get("rxSnr")
        node.rssi = packet.get("rxRssi")
        node.hops_away = packet.get("hopStart", 0) - packet.get("hopLimit", 0)
        node.via_mqtt = packet.get("viaMqtt", False)

        await self._node_repos[node_id].save(node)
        full_node = await self._node_repos[node_id].get(from_id)
        await bus.publish("node.updated", {"node_id": node_id, "node": (full_node or node).to_dict()})


def _node_id_to_num(node_id: str) -> int:
    """Convert '!aabbccdd' hex node id to integer node number."""
    hex_part = node_id.lstrip("!")
    try:
        return int(hex_part, 16)
    except ValueError:
        return 0
