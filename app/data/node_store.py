import aiosqlite
from pathlib import Path

_BASE_DIR = Path.home() / ".appmeshastic" / "nodes"


def db_path(node_id: str) -> Path:
    path = _BASE_DIR / node_id
    path.mkdir(parents=True, exist_ok=True)
    return path / "db.sqlite"


# ---------------------------------------------------------------------------
# Migrations — append only, never edit existing entries
# ---------------------------------------------------------------------------

async def _migrate_v1(db: aiosqlite.Connection) -> None:
    """Initial schema."""
    await db.executescript("""
        CREATE TABLE IF NOT EXISTS messages (
            id INTEGER PRIMARY KEY,
            packet_id INTEGER UNIQUE,
            from_node_id TEXT NOT NULL,
            to_node_id TEXT NOT NULL,
            contact_key TEXT NOT NULL,
            channel INTEGER DEFAULT 0,
            text TEXT,
            reply_to_packet_id INTEGER,
            source TEXT DEFAULT 'radio',
            status TEXT DEFAULT 'received',
            sent_at TIMESTAMP,
            received_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );

        CREATE INDEX IF NOT EXISTS idx_messages_contact ON messages(contact_key, received_at);

        CREATE TABLE IF NOT EXISTS reactions (
            id INTEGER PRIMARY KEY,
            message_packet_id INTEGER NOT NULL,
            from_node_id TEXT NOT NULL,
            emoji TEXT NOT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            UNIQUE(message_packet_id, from_node_id, emoji)
        );

        CREATE TABLE IF NOT EXISTS nodes (
            node_id TEXT PRIMARY KEY,
            long_name TEXT,
            short_name TEXT,
            hw_model TEXT,
            role TEXT,
            latitude REAL,
            longitude REAL,
            altitude REAL,
            battery_level INTEGER,
            snr REAL,
            rssi INTEGER,
            hops_away INTEGER,
            via_mqtt BOOLEAN DEFAULT FALSE,
            is_favorite BOOLEAN DEFAULT FALSE,
            last_seen_at TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS traceroute_history (
            id INTEGER PRIMARY KEY,
            request_id INTEGER,
            dest_node_id TEXT NOT NULL,
            forward_route TEXT,
            return_route TEXT,
            requested_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            completed_at TIMESTAMP
        );

        CREATE INDEX IF NOT EXISTS idx_traceroute_dest ON traceroute_history(dest_node_id, requested_at);

        CREATE TABLE IF NOT EXISTS contact_settings (
            contact_key TEXT PRIMARY KEY,
            mute_until TIMESTAMP,
            last_read_message_id INTEGER,
            last_read_at TIMESTAMP
        );
    """)


async def _migrate_v2(db: aiosqlite.Connection) -> None:
    """Add radio metrics to messages."""
    for col, typedef in [("hops_away", "INTEGER"), ("snr", "REAL"), ("rssi", "INTEGER")]:
        await db.execute(f"ALTER TABLE messages ADD COLUMN {col} {typedef}")


async def _migrate_v3(db: aiosqlite.Connection) -> None:
    """Add extended node fields and traceroute timed_out flag."""
    for col, typedef in [
        ("firmware_version", "TEXT"),
        ("mac_addr", "TEXT"),
        ("voltage", "REAL"),
        ("channel_utilization", "REAL"),
        ("air_util_tx", "REAL"),
        ("uptime_seconds", "INTEGER"),
        ("temperature", "REAL"),
        ("humidity", "REAL"),
        ("pressure", "REAL"),
        ("city", "TEXT"),
        ("public_key", "TEXT"),
        ("is_ignored", "BOOLEAN DEFAULT FALSE"),
    ]:
        await db.execute(f"ALTER TABLE nodes ADD COLUMN {col} {typedef}")
    await db.execute("ALTER TABLE traceroute_history ADD COLUMN timed_out BOOLEAN DEFAULT FALSE")


# Add new migrations here — one function per version, in order.
_MIGRATIONS = [
    _migrate_v1,
    _migrate_v2,
    _migrate_v3,
]


async def init_db(node_id: str) -> None:
    async with aiosqlite.connect(db_path(node_id)) as db:
        # Check if this is an existing DB before we create the migrations table
        row = await (await db.execute(
            "SELECT name FROM sqlite_master WHERE type='table' AND name='messages'"
        )).fetchone()
        existing_db = row is not None

        await db.execute("""
            CREATE TABLE IF NOT EXISTS schema_migrations (
                version INTEGER PRIMARY KEY
            )
        """)
        row = await (await db.execute("SELECT MAX(version) FROM schema_migrations")).fetchone()
        current_version = row[0] if row[0] is not None else 0

        if current_version == 0 and existing_db:
            # Legacy DB: already has all columns, just stamp current version
            latest = len(_MIGRATIONS)
            for v in range(1, latest + 1):
                await db.execute("INSERT INTO schema_migrations (version) VALUES (?)", (v,))
            await db.commit()
            return

        for version, migrate in enumerate(_MIGRATIONS, start=1):
            if version <= current_version:
                continue
            await migrate(db)
            await db.execute("INSERT INTO schema_migrations (version) VALUES (?)", (version,))

        await db.commit()
