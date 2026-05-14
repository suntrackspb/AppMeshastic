def hw_model_name(value) -> str:
    """Convert a numeric hwModel value to its enum name string (e.g. 110 → 'HELTEC_V4').
    Passes through already-string values unchanged."""
    if not value and value != 0:
        return ""
    try:
        num = int(value)
    except (ValueError, TypeError):
        return str(value)
    try:
        from meshtastic.protobuf import mesh_pb2
        return mesh_pb2.HardwareModel.Name(num)
    except Exception:
        return str(value)


def normalize_node_id(node_id) -> str:
    """Normalize any node_id to !hex format (e.g. 2658520692 or '!9e999892' → '!9e999892')."""
    if isinstance(node_id, str) and node_id.startswith("!"):
        return node_id.lower()
    try:
        return f"!{int(node_id):08x}"
    except (ValueError, TypeError):
        return str(node_id)
