import json
from pathlib import Path
from datetime import datetime

_HISTORY_FILE = Path.home() / ".appmeshastic" / "connection_history.json"


def _load() -> list[dict]:
    if not _HISTORY_FILE.exists():
        return []
    try:
        return json.loads(_HISTORY_FILE.read_text())
    except Exception:
        return []


def _save(entries: list[dict]) -> None:
    _HISTORY_FILE.parent.mkdir(parents=True, exist_ok=True)
    _HISTORY_FILE.write_text(json.dumps(entries, indent=2))


def _entry_key(conn_type: str, params: dict) -> str:
    if conn_type == "serial":
        return f"serial:{params['port']}"
    if conn_type == "ble":
        return f"ble:{params['address']}"
    port = params.get("port", 4403)
    return f"wifi:{params['host']}:{port}"


def record(conn_type: str, params: dict) -> None:
    entries = _load()
    key = _entry_key(conn_type, params)
    existing = next((e for e in entries if e["key"] == key), None)
    display_name = existing.get("display_name", "") if existing else ""
    entries = [e for e in entries if e["key"] != key]
    entries.insert(0, {
        "key": key,
        "type": conn_type,
        "params": params,
        "display_name": display_name,
        "last_used": datetime.utcnow().isoformat(),
    })
    _save(entries[:50])


def update_display_name(key: str, display_name: str) -> None:
    entries = _load()
    for e in entries:
        if e["key"] == key:
            e["display_name"] = display_name
            break
    _save(entries)


def get_all() -> list[dict]:
    return _load()


def delete(key: str) -> None:
    entries = [e for e in _load() if e["key"] != key]
    _save(entries)
