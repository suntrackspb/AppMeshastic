import aiosqlite
from ..models import Reaction
from ..node_store import db_path


class ReactionRepository:
    def __init__(self, node_id: str) -> None:
        self._db = db_path(node_id)

    async def save(self, reaction: Reaction) -> None:
        async with aiosqlite.connect(self._db) as db:
            await db.execute(
                """
                INSERT INTO reactions (message_packet_id, from_node_id, emoji, created_at)
                VALUES (?, ?, ?, ?)
                ON CONFLICT(message_packet_id, from_node_id, emoji) DO NOTHING
                """,
                (
                    reaction.message_packet_id,
                    reaction.from_node_id,
                    reaction.emoji,
                    reaction.created_at.isoformat(),
                ),
            )
            await db.commit()

    async def delete(self, message_packet_id: int, from_node_id: str, emoji: str) -> None:
        async with aiosqlite.connect(self._db) as db:
            await db.execute(
                "DELETE FROM reactions WHERE message_packet_id = ? AND from_node_id = ? AND emoji = ?",
                (message_packet_id, from_node_id, emoji),
            )
            await db.commit()

    async def get_by_message(self, message_packet_id: int) -> list[Reaction]:
        async with aiosqlite.connect(self._db) as db:
            db.row_factory = aiosqlite.Row
            rows = await db.execute_fetchall(
                "SELECT * FROM reactions WHERE message_packet_id = ?",
                (message_packet_id,),
            )
            return [
                Reaction(
                    message_packet_id=r["message_packet_id"],
                    from_node_id=r["from_node_id"],
                    emoji=r["emoji"],
                )
                for r in rows
            ]
