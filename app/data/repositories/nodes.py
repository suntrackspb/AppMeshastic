import aiosqlite
from datetime import datetime
from ..models import Node
from ..node_store import db_path


class NodeRepository:
    def __init__(self, node_id: str) -> None:
        self._db = db_path(node_id)

    async def save(self, node: Node) -> None:
        async with aiosqlite.connect(self._db) as db:
            await db.execute(
                """
                INSERT INTO nodes
                    (node_id, long_name, short_name, hw_model, role,
                     latitude, longitude, altitude, battery_level,
                     snr, rssi, hops_away, via_mqtt, is_favorite, is_ignored, last_seen_at,
                     public_key)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(node_id) DO UPDATE SET
                    long_name     = COALESCE(NULLIF(excluded.long_name, ''), long_name),
                    short_name    = COALESCE(NULLIF(excluded.short_name, ''), short_name),
                    hw_model      = COALESCE(NULLIF(excluded.hw_model, ''), hw_model),
                    role          = COALESCE(NULLIF(excluded.role, ''), role),
                    latitude      = COALESCE(excluded.latitude, latitude),
                    longitude     = COALESCE(excluded.longitude, longitude),
                    altitude      = COALESCE(excluded.altitude, altitude),
                    battery_level = COALESCE(excluded.battery_level, battery_level),
                    snr           = COALESCE(excluded.snr, snr),
                    rssi          = COALESCE(excluded.rssi, rssi),
                    hops_away     = COALESCE(excluded.hops_away, hops_away),
                    via_mqtt      = excluded.via_mqtt,
                    last_seen_at  = excluded.last_seen_at,
                    public_key    = COALESCE(excluded.public_key, public_key)
                """,
                (
                    node.node_id,
                    node.long_name,
                    node.short_name,
                    node.hw_model,
                    node.role,
                    node.latitude,
                    node.longitude,
                    node.altitude,
                    node.battery_level,
                    node.snr,
                    node.rssi,
                    node.hops_away,
                    node.via_mqtt,
                    node.is_favorite,
                    node.is_ignored,
                    node.last_seen_at.isoformat() if node.last_seen_at else None,
                    node.public_key,
                ),
            )
            await db.commit()

    async def get_all(self) -> list[Node]:
        async with aiosqlite.connect(self._db) as db:
            db.row_factory = aiosqlite.Row
            rows = await db.execute_fetchall(
                "SELECT * FROM nodes ORDER BY last_seen_at DESC"
            )
            return [_row_to_node(r) for r in rows]

    async def get(self, node_id: str) -> Node | None:
        async with aiosqlite.connect(self._db) as db:
            db.row_factory = aiosqlite.Row
            async with db.execute(
                "SELECT * FROM nodes WHERE node_id = ?", (node_id,)
            ) as cursor:
                row = await cursor.fetchone()
                return _row_to_node(row) if row else None

    async def sync_flags(self, flags: dict[str, dict]) -> None:
        """Overwrite is_favorite/is_ignored for all nodes to match the device state."""
        async with aiosqlite.connect(self._db) as db:
            await db.execute("UPDATE nodes SET is_favorite = 0, is_ignored = 0")
            for nid, f in flags.items():
                if f.get("is_favorite") or f.get("is_ignored"):
                    await db.execute(
                        "UPDATE nodes SET is_favorite = ?, is_ignored = ? WHERE node_id = ?",
                        (f["is_favorite"], f["is_ignored"], nid),
                    )
            await db.commit()

    async def set_favorite(self, node_id: str, is_favorite: bool) -> None:
        async with aiosqlite.connect(self._db) as db:
            await db.execute(
                "UPDATE nodes SET is_favorite = ? WHERE node_id = ?",
                (is_favorite, node_id),
            )
            await db.commit()

    async def set_ignored(self, node_id: str, is_ignored: bool) -> None:
        async with aiosqlite.connect(self._db) as db:
            await db.execute(
                "UPDATE nodes SET is_ignored = ? WHERE node_id = ?",
                (is_ignored, node_id),
            )
            await db.commit()

    async def delete_node(self, node_id: str) -> None:
        async with aiosqlite.connect(self._db) as db:
            await db.execute("DELETE FROM nodes WHERE node_id = ?", (node_id,))
            await db.commit()

    async def clear(self) -> None:
        async with aiosqlite.connect(self._db) as db:
            await db.execute("DELETE FROM nodes")
            await db.commit()

    async def import_from_mirror(self, nodes: list[Node]) -> int:
        async with aiosqlite.connect(self._db) as db:
            await db.executemany(
                """
                INSERT INTO nodes
                    (node_id, long_name, short_name, hw_model, role,
                     latitude, longitude, altitude, battery_level,
                     firmware_version, mac_addr, voltage, channel_utilization,
                     air_util_tx, uptime_seconds, temperature, humidity, pressure,
                     city, last_seen_at, public_key)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(node_id) DO UPDATE SET
                    long_name         = COALESCE(excluded.long_name, long_name),
                    short_name        = COALESCE(excluded.short_name, short_name),
                    hw_model          = COALESCE(excluded.hw_model, hw_model),
                    role              = COALESCE(excluded.role, role),
                    latitude          = COALESCE(excluded.latitude, latitude),
                    longitude         = COALESCE(excluded.longitude, longitude),
                    altitude          = COALESCE(excluded.altitude, altitude),
                    battery_level     = COALESCE(excluded.battery_level, battery_level),
                    firmware_version  = COALESCE(excluded.firmware_version, firmware_version),
                    mac_addr          = COALESCE(excluded.mac_addr, mac_addr),
                    voltage           = COALESCE(excluded.voltage, voltage),
                    channel_utilization = COALESCE(excluded.channel_utilization, channel_utilization),
                    air_util_tx       = COALESCE(excluded.air_util_tx, air_util_tx),
                    uptime_seconds    = COALESCE(excluded.uptime_seconds, uptime_seconds),
                    temperature       = COALESCE(excluded.temperature, temperature),
                    humidity          = COALESCE(excluded.humidity, humidity),
                    pressure          = COALESCE(excluded.pressure, pressure),
                    city              = COALESCE(excluded.city, city),
                    last_seen_at      = CASE
                        WHEN excluded.last_seen_at > last_seen_at THEN excluded.last_seen_at
                        ELSE last_seen_at END,
                    public_key        = COALESCE(excluded.public_key, public_key)
                """,
                [
                    (
                        n.node_id, n.long_name or None, n.short_name or None,
                        n.hw_model or None, n.role or None,
                        n.latitude, n.longitude, n.altitude, n.battery_level,
                        n.firmware_version, n.mac_addr, n.voltage,
                        n.channel_utilization, n.air_util_tx, n.uptime_seconds,
                        n.temperature, n.humidity, n.pressure, n.city,
                        n.last_seen_at.isoformat() if n.last_seen_at else None,
                        n.public_key,
                    )
                    for n in nodes
                ],
            )
            await db.commit()
            return len(nodes)

    async def bulk_save(self, nodes: list[Node]) -> int:
        async with aiosqlite.connect(self._db) as db:
            await db.executemany(
                """
                INSERT INTO nodes
                    (node_id, long_name, short_name, hw_model, role,
                     latitude, longitude, altitude, battery_level,
                     snr, rssi, hops_away, via_mqtt, is_favorite, last_seen_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(node_id) DO UPDATE SET
                    long_name = COALESCE(excluded.long_name, long_name),
                    short_name = COALESCE(excluded.short_name, short_name),
                    latitude = COALESCE(excluded.latitude, latitude),
                    longitude = COALESCE(excluded.longitude, longitude),
                    altitude = COALESCE(excluded.altitude, altitude),
                    last_seen_at = CASE
                        WHEN excluded.last_seen_at > last_seen_at THEN excluded.last_seen_at
                        ELSE last_seen_at END
                """,
                [
                    (
                        n.node_id, n.long_name, n.short_name, n.hw_model, n.role,
                        n.latitude, n.longitude, n.altitude, n.battery_level,
                        n.snr, n.rssi, n.hops_away, n.via_mqtt, n.is_favorite,
                        n.last_seen_at.isoformat() if n.last_seen_at else None,
                    )
                    for n in nodes
                ],
            )
            await db.commit()
            return len(nodes)


def _row_to_node(row: aiosqlite.Row) -> Node:
    keys = row.keys() if hasattr(row, "keys") else []
    def _get(col, default=None):
        try:
            return row[col]
        except (IndexError, KeyError):
            return default

    return Node(
        node_id=row["node_id"],
        long_name=row["long_name"] or "",
        short_name=row["short_name"] or "",
        hw_model=row["hw_model"] or "",
        role=row["role"] or "",
        latitude=row["latitude"],
        longitude=row["longitude"],
        altitude=row["altitude"],
        battery_level=row["battery_level"],
        snr=row["snr"],
        rssi=row["rssi"],
        hops_away=row["hops_away"],
        via_mqtt=bool(row["via_mqtt"]),
        is_favorite=bool(row["is_favorite"]),
        is_ignored=bool(_get("is_ignored", False)),
        last_seen_at=datetime.fromisoformat(row["last_seen_at"]) if row["last_seen_at"] else None,
        firmware_version=_get("firmware_version"),
        mac_addr=_get("mac_addr"),
        voltage=_get("voltage"),
        channel_utilization=_get("channel_utilization"),
        air_util_tx=_get("air_util_tx"),
        uptime_seconds=_get("uptime_seconds"),
        temperature=_get("temperature"),
        humidity=_get("humidity"),
        pressure=_get("pressure"),
        city=_get("city"),
        public_key=_get("public_key"),
    )
