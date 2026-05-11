import aiosqlite
from pathlib import Path

_SCHEMA = """
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
    received_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    hops_away INTEGER,
    snr REAL,
    rssi INTEGER
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
    is_ignored BOOLEAN DEFAULT FALSE,
    last_seen_at TIMESTAMP,
    firmware_version TEXT,
    mac_addr TEXT,
    voltage REAL,
    channel_utilization REAL,
    air_util_tx REAL,
    uptime_seconds INTEGER,
    temperature REAL,
    humidity REAL,
    pressure REAL,
    city TEXT,
    public_key TEXT
);

CREATE TABLE IF NOT EXISTS traceroute_history (
    id INTEGER PRIMARY KEY,
    request_id INTEGER,
    dest_node_id TEXT NOT NULL,
    forward_route TEXT,
    return_route TEXT,
    requested_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    completed_at TIMESTAMP,
    timed_out BOOLEAN DEFAULT FALSE
);

CREATE INDEX IF NOT EXISTS idx_traceroute_dest ON traceroute_history(dest_node_id, requested_at);

CREATE TABLE IF NOT EXISTS contact_settings (
    contact_key TEXT PRIMARY KEY,
    mute_until TIMESTAMP,
    last_read_message_id INTEGER,
    last_read_at TIMESTAMP
);
"""

_BASE_DIR = Path.home() / ".appmeshastic" / "nodes"


def db_path(node_id: str) -> Path:
    path = _BASE_DIR / node_id
    path.mkdir(parents=True, exist_ok=True)
    return path / "db.sqlite"


async def init_db(node_id: str) -> None:
    async with aiosqlite.connect(db_path(node_id)) as db:
        await db.executescript(_SCHEMA)
        # Migrate existing DBs that lack new columns
        for col, typedef in [("hops_away", "INTEGER"), ("snr", "REAL"), ("rssi", "INTEGER")]:
            try:
                await db.execute(f"ALTER TABLE messages ADD COLUMN {col} {typedef}")
            except Exception:
                pass
        for col, typedef in [
            ("firmware_version", "TEXT"), ("mac_addr", "TEXT"),
            ("voltage", "REAL"), ("channel_utilization", "REAL"),
            ("air_util_tx", "REAL"), ("uptime_seconds", "INTEGER"),
            ("temperature", "REAL"), ("humidity", "REAL"),
            ("pressure", "REAL"), ("city", "TEXT"), ("public_key", "TEXT"),
            ("is_ignored", "BOOLEAN DEFAULT FALSE"),
        ]:
            try:
                await db.execute(f"ALTER TABLE nodes ADD COLUMN {col} {typedef}")
            except Exception:
                pass
        try:
            await db.execute("ALTER TABLE traceroute_history ADD COLUMN timed_out BOOLEAN DEFAULT FALSE")
        except Exception:
            pass
        await db.commit()
