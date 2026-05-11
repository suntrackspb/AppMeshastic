import logging

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
