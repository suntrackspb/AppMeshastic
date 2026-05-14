import json
from pathlib import Path

_BASE_DIR = Path.home() / ".appmeshastic"
_FILE = _BASE_DIR / "quick_emojis.json"

DEFAULT_EMOJIS = [
    '1️⃣','2️⃣','3️⃣','4️⃣','5️⃣','6️⃣','7️⃣',
    '👍','👎','❤️','🔥','😂','🤝','😢','😡',
    '🙏','✅','👀','🤔','💯','🎉','😎','🤣',
    '😍','🥳','😴','💪','⚡️',
]


def load() -> list[str]:
    if not _FILE.exists():
        _BASE_DIR.mkdir(parents=True, exist_ok=True)
        _FILE.write_text(json.dumps(DEFAULT_EMOJIS, ensure_ascii=False), encoding="utf-8")
        return list(DEFAULT_EMOJIS)
    try:
        data = json.loads(_FILE.read_text(encoding="utf-8"))
        if isinstance(data, list):
            return [str(e) for e in data]
    except Exception:
        pass
    return list(DEFAULT_EMOJIS)


def save(emojis: list[str]) -> None:
    _BASE_DIR.mkdir(parents=True, exist_ok=True)
    _FILE.write_text(json.dumps(emojis, ensure_ascii=False), encoding="utf-8")
