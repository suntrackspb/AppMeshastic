import json
import aiosqlite
from datetime import datetime
from ..node_store import db_path


class TracerouteRepository:
    def __init__(self, node_id: str) -> None:
        self._db = db_path(node_id)

    async def save_request(self, dest_node_id: str, request_id: int) -> int:
        async with aiosqlite.connect(self._db) as db:
            cursor = await db.execute(
                "INSERT INTO traceroute_history (request_id, dest_node_id, requested_at) VALUES (?, ?, ?)",
                (request_id, dest_node_id, datetime.utcnow().isoformat()),
            )
            await db.commit()
            return cursor.lastrowid

    async def complete(
        self,
        request_id: int,
        forward_route: list[str],
        return_route: list[str],
    ) -> None:
        async with aiosqlite.connect(self._db) as db:
            await db.execute(
                """
                UPDATE traceroute_history
                SET forward_route = ?, return_route = ?, completed_at = ?
                WHERE request_id = ?
                """,
                (
                    json.dumps(forward_route),
                    json.dumps(return_route),
                    datetime.utcnow().isoformat(),
                    request_id,
                ),
            )
            await db.commit()

    async def timeout_request(self, request_id: int) -> None:
        async with aiosqlite.connect(self._db) as db:
            await db.execute(
                "UPDATE traceroute_history SET timed_out = TRUE, completed_at = ? WHERE request_id = ? AND completed_at IS NULL",
                (datetime.utcnow().isoformat(), request_id),
            )
            await db.commit()

    async def get_history(self, dest_node_id: str, limit: int = 20) -> list[dict]:
        async with aiosqlite.connect(self._db) as db:
            db.row_factory = aiosqlite.Row
            rows = await db.execute_fetchall(
                """
                SELECT * FROM traceroute_history
                WHERE dest_node_id = ?
                ORDER BY requested_at DESC
                LIMIT ?
                """,
                (dest_node_id, limit),
            )
            return [_row_to_dict(r) for r in rows]


def _row_to_dict(row: aiosqlite.Row) -> dict:
    forward = json.loads(row["forward_route"]) if row["forward_route"] else []
    return_r = json.loads(row["return_route"]) if row["return_route"] else []
    return {
        "id": row["id"],
        "request_id": row["request_id"],
        "dest_node_id": row["dest_node_id"],
        "forward_route": forward,
        "return_route": return_r,
        "requested_at": row["requested_at"],
        "completed_at": row["completed_at"],
        "timed_out": bool(row["timed_out"]),
    }
