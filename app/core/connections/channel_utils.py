import logging
from ..node_id_utils import normalize_node_id

logger = logging.getLogger(__name__)


def read_channels(interface) -> list[dict]:
    """Read active channels from a connected meshtastic interface."""
    try:
        from meshtastic.protobuf import channel_pb2
        PRIMARY = channel_pb2.Channel.Role.PRIMARY
        DISABLED = channel_pb2.Channel.Role.DISABLED
    except ImportError:
        PRIMARY = 1
        DISABLED = 0

    channels = []
    try:
        for ch in interface.localNode.channels:
            if ch.role == DISABLED:
                continue
            name = ch.settings.name if ch.settings.name else (
                "Primary" if ch.role == PRIMARY else f"Ch{ch.index}"
            )
            channels.append({
                "index": ch.index,
                "name": name,
                "role": "primary" if ch.role == PRIMARY else "secondary",
            })
    except Exception:
        logger.exception("Failed to read channels from interface")

    if not channels:
        channels = [{"index": 0, "name": "Primary", "role": "primary"}]

    logger.debug("read_channels: %s", channels)
    return channels


def read_node_flags(interface) -> dict[str, dict]:
    """Read isFavorite/isIgnored flags from nodesByNum at connect time."""
    result = {}
    try:
        for num, entry in (interface.nodesByNum or {}).items():
            nid = normalize_node_id(num)
            result[nid] = {
                "is_favorite": bool(entry.get("isFavorite", False)),
                "is_ignored": bool(entry.get("isIgnored", False)),
            }
    except Exception:
        logger.exception("Failed to read node flags from interface")
    return result
