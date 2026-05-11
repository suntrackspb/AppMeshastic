def normalize_node_id(node_id) -> str:
    """Normalize any node_id to !hex format (e.g. 2658520692 or '!9e999892' → '!9e999892')."""
    if isinstance(node_id, str) and node_id.startswith("!"):
        return node_id.lower()
    try:
        return f"!{int(node_id):08x}"
    except (ValueError, TypeError):
        return str(node_id)
