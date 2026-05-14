import aiosqlite
from datetime import datetime
from ..models import Message, Reaction
from ..node_store import db_path


class MessageRepository:
    def __init__(self, node_id: str) -> None:
        self._db = db_path(node_id)

    async def save(self, msg: Message) -> int:
        async with aiosqlite.connect(self._db) as db:
            cursor = await db.execute(
                """
                INSERT INTO messages
                    (packet_id, from_node_id, to_node_id, contact_key, channel,
                     text, reply_to_packet_id, source, status, sent_at, received_at,
                     hops_away, snr, rssi)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(packet_id) DO NOTHING
                """,
                (
                    msg.packet_id,
                    msg.from_node_id,
                    msg.to_node_id,
                    msg.contact_key,
                    msg.channel,
                    msg.text,
                    msg.reply_to_packet_id,
                    msg.source,
                    msg.status,
                    msg.sent_at.isoformat() if msg.sent_at else None,
                    msg.received_at.isoformat(),
                    msg.hops_away,
                    msg.snr,
                    msg.rssi,
                ),
            )
            await db.commit()
            return cursor.lastrowid

    async def update_status(self, packet_id: int, status: str) -> None:
        async with aiosqlite.connect(self._db) as db:
            await db.execute(
                "UPDATE messages SET status = ? WHERE packet_id = ?",
                (status, packet_id),
            )
            await db.commit()

    async def get_by_contact(
        self, contact_key: str, before_id: int | None = None, limit: int = 100
    ) -> list[Message]:
        async with aiosqlite.connect(self._db) as db:
            db.row_factory = aiosqlite.Row
            if before_id:
                rows = await db.execute_fetchall(
                    """
                    SELECT * FROM messages
                    WHERE contact_key = ? AND id < ?
                    ORDER BY received_at DESC LIMIT ?
                    """,
                    (contact_key, before_id, limit),
                )
            else:
                rows = await db.execute_fetchall(
                    """
                    SELECT * FROM messages
                    WHERE contact_key = ?
                    ORDER BY received_at DESC LIMIT ?
                    """,
                    (contact_key, limit),
                )
            messages = [_row_to_message(r) for r in rows]
            await self._attach_reactions(db, messages)
            return list(reversed(messages))

    async def fail_pending(self, from_node_id: str) -> None:
        async with aiosqlite.connect(self._db) as db:
            await db.execute(
                "UPDATE messages SET status = 'error' WHERE status IN ('queued', 'enroute') AND from_node_id = ?",
                (from_node_id,),
            )
            await db.commit()

    async def clear_by_contact(self, contact_key: str) -> None:
        async with aiosqlite.connect(self._db) as db:
            await db.execute(
                "DELETE FROM messages WHERE contact_key = ?", (contact_key,)
            )
            await db.commit()

    async def _attach_reactions(
        self, db: aiosqlite.Connection, messages: list[Message]
    ) -> None:
        if not messages:
            return
        packet_ids = [m.packet_id for m in messages if m.packet_id]
        if not packet_ids:
            return
        placeholders = ",".join("?" * len(packet_ids))
        rows = await db.execute_fetchall(
            f"SELECT * FROM reactions WHERE message_packet_id IN ({placeholders})",
            packet_ids,
        )
        reactions_map: dict[int, list[Reaction]] = {}
        for r in rows:
            pid = r["message_packet_id"]
            reactions_map.setdefault(pid, []).append(_row_to_reaction(r))
        for msg in messages:
            msg.reactions = reactions_map.get(msg.packet_id, [])


def _row_to_message(row: aiosqlite.Row) -> Message:
    return Message(
        id=row["id"],
        packet_id=row["packet_id"],
        from_node_id=row["from_node_id"],
        to_node_id=row["to_node_id"],
        contact_key=row["contact_key"],
        channel=row["channel"],
        text=row["text"] or "",
        reply_to_packet_id=row["reply_to_packet_id"],
        source=row["source"],
        status=row["status"],
        sent_at=datetime.fromisoformat(row["sent_at"]) if row["sent_at"] else None,
        received_at=datetime.fromisoformat(row["received_at"]),
        hops_away=row["hops_away"],
        snr=row["snr"],
        rssi=row["rssi"],
    )


def _row_to_reaction(row: aiosqlite.Row) -> Reaction:
    return Reaction(
        message_packet_id=row["message_packet_id"],
        from_node_id=row["from_node_id"],
        emoji=row["emoji"],
        created_at=datetime.fromisoformat(row["created_at"]),
    )
