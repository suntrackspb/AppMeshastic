from dataclasses import dataclass, field
from datetime import datetime
from typing import Literal


@dataclass
class Node:
    node_id: str
    long_name: str = ""
    short_name: str = ""
    hw_model: str = ""
    role: str = ""
    latitude: float | None = None
    longitude: float | None = None
    altitude: float | None = None
    battery_level: int | None = None
    snr: float | None = None
    rssi: int | None = None
    hops_away: int | None = None
    via_mqtt: bool = False
    is_favorite: bool = False
    is_ignored: bool = False
    last_seen_at: datetime | None = None
    firmware_version: str | None = None
    mac_addr: str | None = None
    voltage: float | None = None
    channel_utilization: float | None = None
    air_util_tx: float | None = None
    uptime_seconds: int | None = None
    temperature: float | None = None
    humidity: float | None = None
    pressure: float | None = None
    city: str | None = None
    public_key: str | None = None

    def to_dict(self) -> dict:
        return {
            "node_id": self.node_id,
            "long_name": self.long_name,
            "short_name": self.short_name,
            "hw_model": self.hw_model,
            "role": self.role,
            "latitude": self.latitude,
            "longitude": self.longitude,
            "altitude": self.altitude,
            "battery_level": self.battery_level,
            "snr": self.snr,
            "rssi": self.rssi,
            "hops_away": self.hops_away,
            "via_mqtt": self.via_mqtt,
            "is_favorite": self.is_favorite,
            "is_ignored": self.is_ignored,
            "last_seen_at": self.last_seen_at.isoformat() if self.last_seen_at else None,
            "firmware_version": self.firmware_version,
            "mac_addr": self.mac_addr,
            "voltage": self.voltage,
            "channel_utilization": self.channel_utilization,
            "air_util_tx": self.air_util_tx,
            "uptime_seconds": self.uptime_seconds,
            "temperature": self.temperature,
            "humidity": self.humidity,
            "pressure": self.pressure,
            "city": self.city,
            "public_key": self.public_key,
        }


@dataclass
class Reaction:
    message_packet_id: int
    from_node_id: str
    emoji: str
    created_at: datetime = field(default_factory=datetime.utcnow)

    def to_dict(self) -> dict:
        return {
            "message_packet_id": self.message_packet_id,
            "from_node_id": self.from_node_id,
            "emoji": self.emoji,
            "created_at": self.created_at.isoformat(),
        }


MessageSource = Literal["radio", "internet", "mirror"]
MessageStatus = Literal["queued", "enroute", "delivered", "received", "error"]


@dataclass
class Message:
    from_node_id: str
    to_node_id: str
    contact_key: str
    channel: int = 0
    text: str = ""
    reply_to_packet_id: int | None = None
    source: MessageSource = "radio"
    status: MessageStatus = "received"
    sent_at: datetime | None = None
    received_at: datetime = field(default_factory=datetime.utcnow)
    packet_id: int | None = None
    id: int | None = None
    hops_away: int | None = None
    snr: float | None = None
    rssi: int | None = None
    reactions: list[Reaction] = field(default_factory=list)

    def to_dict(self) -> dict:
        return {
            "id": self.id,
            "packet_id": self.packet_id,
            "from_node_id": self.from_node_id,
            "to_node_id": self.to_node_id,
            "contact_key": self.contact_key,
            "channel": self.channel,
            "text": self.text,
            "reply_to_packet_id": self.reply_to_packet_id,
            "source": self.source,
            "status": self.status,
            "sent_at": (self.sent_at.isoformat() + "Z") if self.sent_at else None,
            "received_at": self.received_at.isoformat() + "Z",
            "hops_away": self.hops_away,
            "snr": self.snr,
            "rssi": self.rssi,
            "reactions": [r.to_dict() for r in self.reactions],
        }


@dataclass
class ContactSettings:
    contact_key: str
    mute_until: datetime | None = None
    last_read_message_id: int | None = None
    last_read_at: datetime | None = None
