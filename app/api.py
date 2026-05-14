import asyncio
import json
import logging
import ssl
import sys
import urllib.request
from concurrent.futures import Future
from datetime import datetime
from typing import Any

import webview

from .core.node_manager import NodeManager, ConnectionType
from .core.internet_bridge import InternetBridge
from .core.message_bus import bus
from .core import connection_history as conn_hist

logger = logging.getLogger(__name__)


class Api:
    """
    Exposed to the frontend via pywebview.
    All public methods are callable from JS as window.pywebview.api.<method>().
    Sync wrappers run coroutines on the background asyncio loop.
    """

    def __init__(self, node_manager: NodeManager, loop: asyncio.AbstractEventLoop) -> None:
        self._nm = node_manager
        self._loop = loop
        self._window: webview.Window | None = None
        self._bridge: InternetBridge | None = None

        bus.subscribe("message.new", self._push_message)
        bus.subscribe("message.ack", self._push_ack)
        bus.subscribe("reaction.new", self._push_reaction)
        bus.subscribe("node.connected", self._push_node_connected)
        bus.subscribe("node.disconnected", self._push_node_disconnected)
        bus.subscribe("node.updated", self._push_node_updated)
        bus.subscribe("mirror.connected", self._push_mirror_connected)
        bus.subscribe("mirror.disconnected", self._push_mirror_disconnected)
        bus.subscribe("relay.info", self._push_relay_info)
        bus.subscribe("relay.update", self._push_relay_update)
        bus.subscribe("traceroute.result", self._push_traceroute_result)
        bus.subscribe("traceroute.timeout", self._push_traceroute_timeout)

    def set_window(self, window: webview.Window) -> None:
        self._window = window

    # ------------------------------------------------------------------
    # Connection management
    # ------------------------------------------------------------------

    def connect_node(self, conn_type: str, params: dict) -> dict:
        node_id = self._run(self._nm.connect(conn_type, params), timeout=60)  # type: ignore[arg-type]
        conn_hist.record(conn_type, params)
        self._report_connect(node_id)
        self._update_history_display_name(conn_type, params, node_id)
        return node_id

    def _update_history_display_name(self, conn_type: str, params: dict, node_id: str) -> None:
        import threading
        def _update():
            try:
                import time
                time.sleep(2)
                repo = self._nm._node_repos.get(node_id)
                if not repo:
                    return
                import asyncio
                loop = asyncio.new_event_loop()
                node = loop.run_until_complete(repo.get(node_id))
                loop.close()
                if node and node.long_name:
                    display_name = f"{node.long_name} - {node_id}"
                else:
                    display_name = node_id
                key = conn_hist._entry_key(conn_type, params)
                conn_hist.update_display_name(key, display_name)
            except Exception as e:
                logger.debug("_update_history_display_name failed: %s", e)
        threading.Thread(target=_update, daemon=True).start()

    def _report_connect(self, node_id: str) -> None:
        import threading
        import urllib.request as _req
        def _send():
            try:
                body = json.dumps({"node_id": node_id}).encode()
                r = _req.Request(
                    "https://m.etohost.ru/api/app/connect",
                    data=body,
                    headers={"Content-Type": "application/json"},
                    method="POST",
                )
                import ssl, certifi, os
                cafile = (
                    os.path.join(sys._MEIPASS, "certifi", "cacert.pem")
                    if getattr(sys, "frozen", False)
                    else certifi.where()
                )
                ctx = ssl.create_default_context(cafile=cafile)
                with _req.urlopen(r, timeout=10, context=ctx):
                    pass
            except Exception as e:
                logger.debug("_report_connect failed: %s", e)
        threading.Thread(target=_send, daemon=True).start()

    def disconnect_node(self, node_id: str) -> None:
        self._run(self._nm.disconnect(node_id))

    def set_active_node(self, node_id: str) -> None:
        self._nm.set_active(node_id)

    def get_connected_nodes(self) -> list[str]:
        return self._nm.connected_node_ids()

    def get_connected_nodes_info(self) -> list[dict]:
        return self._run(self._nm.connected_nodes_info())

    def get_active_node(self) -> str | None:
        return self._nm.get_active_node_id()

    # ------------------------------------------------------------------
    # Messages
    # ------------------------------------------------------------------

    def get_messages(
        self, contact_key: str, before_id: int | None = None, limit: int = 50
    ) -> list[dict]:
        node_id = self._nm.get_active_node_id()
        if not node_id:
            return []
        msg_repo, _, _ = self._nm.repos(node_id)
        messages = self._run(msg_repo.get_by_contact(contact_key, before_id, limit))
        return [m.to_dict() for m in messages]

    def send_message(
        self, text: str, contact_key: str, channel: int = 0, reply_to: int | None = None
    ) -> dict:
        node_id = self._nm.get_active_node_id()
        if not node_id:
            return {"error": "No active node"}
        destination_id = contact_key.split("_", 1)[1] if "_" in contact_key else "^all"
        packet_id = self._run(self._nm.send_text(node_id, text, channel, reply_to, destination_id))
        return {"packet_id": packet_id}

    # ------------------------------------------------------------------
    # Reactions
    # ------------------------------------------------------------------

    def send_reaction(self, emoji: str, packet_id: int, channel: int = 0, destination_id: str = "^all") -> None:
        node_id = self._nm.get_active_node_id()
        if node_id:
            self._run(self._nm.send_reaction(node_id, emoji, packet_id, channel, destination_id))

    # ------------------------------------------------------------------
    # Nodes in mesh
    # ------------------------------------------------------------------

    def get_channels(self) -> list[dict]:
        node_id = self._nm.get_active_node_id()
        if not node_id:
            return [{"index": 0, "name": "Primary", "role": "primary"}]
        return self._nm.get_channels(node_id)

    def get_nodes(self) -> list[dict]:
        node_id = self._nm.get_active_node_id()
        if not node_id:
            return []
        _, _, node_repo = self._nm.repos(node_id)
        nodes = self._run(node_repo.get_all())
        return [n.to_dict() for n in nodes]

    # ------------------------------------------------------------------
    # Settings actions
    # ------------------------------------------------------------------

    def import_nodes_from_url(self, url: str) -> dict:
        node_id = self._nm.get_active_node_id()
        if not node_id:
            return {"error": "No active node"}
        try:
            import certifi, os
            cafile = (
                os.path.join(sys._MEIPASS, "certifi", "cacert.pem")
                if getattr(sys, "frozen", False)
                else certifi.where()
            )
            ssl_ctx = ssl.create_default_context(cafile=cafile)
            with urllib.request.urlopen(url, timeout=15, context=ssl_ctx) as resp:
                data = json.loads(resp.read())
        except Exception as e:
            return {"error": str(e)}

        from .data.models import Node

        # Mirror format: {"nodes": [...], "count": N, "generated_at": "..."}
        if isinstance(data, dict) and "nodes" in data:
            return self._import_from_mirror_data(data["nodes"], node_id)

        # Legacy onemesh.ru format: positional array
        nodes = []
        for row in data:
            try:
                numeric = int(str(row[1]))
                node_hex = f"!{numeric:08x}"
                last_seen = None
                if row[17]:
                    try:
                        last_seen = datetime.fromisoformat(str(row[17]))
                    except ValueError:
                        pass
                nodes.append(Node(
                    node_id=node_hex,
                    long_name=str(row[2]) if row[2] else "",
                    short_name=str(row[3]) if row[3] else "",
                    latitude=float(row[19]) if row[19] is not None else None,
                    longitude=float(row[20]) if row[20] is not None else None,
                    altitude=float(row[21]) if row[21] is not None else None,
                    last_seen_at=last_seen,
                ))
            except (IndexError, TypeError, ValueError):
                continue

        _, _, node_repo = self._nm.repos(node_id)
        count = self._run(node_repo.bulk_save(nodes))
        return {"imported": count}

    def _import_from_mirror_data(self, raw_nodes: list, node_id: str) -> dict:
        from .data.models import Node
        nodes = []
        for row in raw_nodes:
            if not isinstance(row, dict):
                continue
            try:
                last_seen = None
                if row.get("last_seen_at"):
                    try:
                        last_seen = datetime.fromisoformat(row["last_seen_at"])
                    except ValueError:
                        pass
                nodes.append(Node(
                    node_id=row["node_id"],
                    long_name=row.get("long_name") or "",
                    short_name=row.get("short_name") or "",
                    hw_model=str(row.get("hw_model") or ""),
                    role=row.get("role") or "",
                    latitude=row.get("last_lat"),
                    longitude=row.get("last_lon"),
                    altitude=row.get("last_alt"),
                    battery_level=row.get("battery_level"),
                    firmware_version=row.get("firmware_version"),
                    mac_addr=row.get("mac_addr"),
                    voltage=row.get("voltage"),
                    channel_utilization=row.get("channel_utilization"),
                    air_util_tx=row.get("air_util_tx"),
                    uptime_seconds=row.get("uptime_seconds"),
                    temperature=row.get("temperature"),
                    humidity=row.get("humidity"),
                    pressure=row.get("pressure"),
                    city=row.get("city"),
                    public_key=row.get("public_key"),
                    last_seen_at=last_seen,
                ))
            except (KeyError, TypeError, ValueError):
                continue

        _, _, node_repo = self._nm.repos(node_id)
        count = self._run(node_repo.import_from_mirror(nodes))
        return {"imported": count}

    def request_user_info(self, dest_node_id: str) -> dict:
        node_id = self._nm.get_active_node_id()
        if not node_id:
            return {"error": "No active node"}
        try:
            self._run(self._nm.request_user_info(node_id, dest_node_id))
            return {"ok": True}
        except Exception as e:
            return {"error": str(e)}

    def send_traceroute(self, dest_node_id: str) -> dict:
        node_id = self._nm.get_active_node_id()
        if not node_id:
            return {"error": "No active node"}
        try:
            packet_id = self._run(self._nm.send_traceroute(node_id, dest_node_id))
            return {"ok": True, "packet_id": packet_id}
        except Exception as e:
            return {"error": str(e)}

    def set_node_favorite(self, dest_node_id: str, value: bool) -> dict:
        node_id = self._nm.get_active_node_id()
        if not node_id:
            return {"error": "No active node"}
        try:
            self._run(self._nm.set_node_favorite(node_id, dest_node_id, value))
            return {"ok": True}
        except Exception as e:
            return {"error": str(e)}

    def set_node_ignored(self, dest_node_id: str, value: bool) -> dict:
        node_id = self._nm.get_active_node_id()
        if not node_id:
            return {"error": "No active node"}
        try:
            self._run(self._nm.set_node_ignored(node_id, dest_node_id, value))
            return {"ok": True}
        except Exception as e:
            return {"error": str(e)}

    def delete_node(self, dest_node_id: str) -> dict:
        node_id = self._nm.get_active_node_id()
        if not node_id:
            return {"error": "No active node"}
        try:
            self._run(self._nm.delete_node(node_id, dest_node_id))
            return {"ok": True}
        except Exception as e:
            return {"error": str(e)}

    def get_device_config(self, node_id: str) -> dict:
        try:
            conn = self._nm._connections.get(node_id)
            if not conn:
                return {"error": "Node not connected"}
            return self._run(conn.get_device_config())
        except Exception as e:
            return {"error": str(e)}

    def set_device_config(self, node_id: str, config: dict) -> dict:
        try:
            conn = self._nm._connections.get(node_id)
            if not conn:
                return {"error": "Node not connected"}
            self._run(conn.set_device_config(config))
            return {"ok": True}
        except Exception as e:
            return {"error": str(e)}

    def get_traceroute_history(self, dest_node_id: str) -> list[dict]:
        node_id = self._nm.get_active_node_id()
        if not node_id:
            return []
        tr_repo = self._nm._traceroute_repos.get(node_id)
        if not tr_repo:
            return []
        history = self._run(tr_repo.get_history(dest_node_id))
        _, _, node_repo = self._nm.repos(node_id)
        nodes = {n.node_id: n for n in self._run(node_repo.get_all())}
        for tr in history:
            for hop in tr["forward_route"] + tr["return_route"]:
                if isinstance(hop, dict):
                    n = nodes.get(hop["node_id"])
                    hop["name"] = (n.long_name or n.short_name) if n else None
        return history

    def clear_nodes(self) -> None:
        node_id = self._nm.get_active_node_id()
        if not node_id:
            return
        _, _, node_repo = self._nm.repos(node_id)
        self._run(node_repo.clear())

    def clear_chat(self, contact_key: str) -> None:
        node_id = self._nm.get_active_node_id()
        if not node_id:
            return
        msg_repo, _, _ = self._nm.repos(node_id)
        self._run(msg_repo.clear_by_contact(contact_key))

    # ------------------------------------------------------------------
    # Mirror (mesh-mirror WebSocket bridge)
    # ------------------------------------------------------------------

    def connect_mirror(self, url: str = "wss://m.etohost.ru/ws") -> None:
        self._run(self._nm.connect_mirror(url))

    def disconnect_mirror(self) -> None:
        self._run(self._nm.disconnect_mirror())

    def get_mirror_status(self) -> dict:
        return self._nm.mirror_status()

    # ------------------------------------------------------------------
    # Internet bridge
    # ------------------------------------------------------------------

    def connect_internet_bridge(self, url: str) -> None:
        node_id = self._nm.get_active_node_id()
        if not node_id:
            return
        msg_repo, _, _ = self._nm.repos(node_id)

        if self._bridge:
            self._bridge.stop()

        self._bridge = InternetBridge(url, msg_repo)
        self._bridge.start()

    def disconnect_internet_bridge(self) -> None:
        if self._bridge:
            self._bridge.stop()
            self._bridge = None

    # ------------------------------------------------------------------
    # Serial port discovery
    # ------------------------------------------------------------------

    def open_url_in_browser(self, url: str) -> None:
        import webbrowser
        webbrowser.open(url)

    def open_relay_map(self, mirror_msg_id: str) -> None:
        url = f"https://m.etohost.ru/?relay-map-standalone={mirror_msg_id}"
        webview.create_window("Карта шлюзов", url=url, width=900, height=650, resizable=True, background_color="#1a1a1a")

    def list_serial_ports(self) -> list[str]:
        import serial.tools.list_ports
        return [p.device for p in serial.tools.list_ports.comports()]

    # ------------------------------------------------------------------
    # BLE device scan
    # ------------------------------------------------------------------

    def scan_ble_devices(self) -> list[dict]:
        try:
            from meshtastic.ble_interface import BLEInterface
            devices = BLEInterface.scan()
            return [{"address": d.address, "name": d.name or ""} for d in devices]
        except Exception as e:
            logger.warning("BLE scan failed: %s", e)
            return []

    # ------------------------------------------------------------------
    # Connection history
    # ------------------------------------------------------------------

    def get_connection_history(self) -> list[dict]:
        return conn_hist.get_all()

    def delete_connection_history_entry(self, key: str) -> None:
        conn_hist.delete(key)

    # ------------------------------------------------------------------
    # Push events → JS
    # ------------------------------------------------------------------

    async def _push_message(self, payload: Any) -> None:
        self._emit("message.new", payload)

    async def _push_ack(self, payload: Any) -> None:
        self._emit("message.ack", payload)

    async def _push_reaction(self, payload: Any) -> None:
        self._emit("reaction.new", payload)

    async def _push_node_connected(self, payload: Any) -> None:
        self._emit("node.connected", payload)

    async def _push_node_disconnected(self, payload: Any) -> None:
        self._emit("node.disconnected", payload)

    async def _push_node_updated(self, payload: Any) -> None:
        self._emit("node.updated", payload)

    async def _push_mirror_connected(self, payload: Any) -> None:
        self._emit("mirror.connected", payload)

    async def _push_mirror_disconnected(self, payload: Any) -> None:
        self._emit("mirror.disconnected", payload)

    async def _push_relay_info(self, payload: Any) -> None:
        self._emit("relay.info", payload)

    async def _push_relay_update(self, payload: Any) -> None:
        self._emit("relay.update", payload)

    async def _push_traceroute_result(self, payload: Any) -> None:
        node_id = self._nm.get_active_node_id()
        if node_id:
            _, _, node_repo = self._nm.repos(node_id)
            nodes = {n.node_id: n for n in await node_repo.get_all()}
            for hop in payload.get("forward_route", []) + payload.get("return_route", []):
                if isinstance(hop, dict):
                    n = nodes.get(hop["node_id"])
                    hop["name"] = (n.long_name or n.short_name) if n else None
        self._emit("traceroute.result", payload)

    async def _push_traceroute_timeout(self, payload: Any) -> None:
        self._emit("traceroute.timeout", payload)

    def _emit(self, event: str, payload: Any) -> None:
        if not self._window:
            logger.warning("_emit called but window not set, event=%s", event)
            return
        data = json.dumps({"event": event, "payload": payload})
        logger.debug("_emit event=%s", event)
        result = self._window.evaluate_js(f"window.__onMeshEvent && window.__onMeshEvent({data})")
        logger.debug("_emit evaluate_js result=%r", result)

    # ------------------------------------------------------------------
    # Updates
    # ------------------------------------------------------------------

    def apply_update(self) -> dict:
        from . import updater
        if not updater.pending_update:
            return {"error": "no pending update"}
        tag, url = updater.pending_update
        self._run(updater.download_and_apply(tag, url), timeout=180)
        return {}

    # ------------------------------------------------------------------
    # Helpers
    # ------------------------------------------------------------------

    def _run(self, coro, timeout: float = 10) -> Any:
        future: Future = asyncio.run_coroutine_threadsafe(coro, self._loop)
        return future.result(timeout=timeout)
