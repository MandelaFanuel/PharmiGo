import json
from typing import Any


def clean_for_json(data: Any, seen: set[int] | None = None) -> Any:
    if seen is None:
        seen = set()

    if data is None or isinstance(data, (str, int, float, bool)):
        return data

    obj_id = id(data)
    if obj_id in seen:
        return "[circular-reference]"

    if isinstance(data, dict):
        seen.add(obj_id)
        cleaned = {str(key): clean_for_json(value, seen) for key, value in data.items()}
        seen.discard(obj_id)
        return cleaned

    if isinstance(data, (list, tuple, set)):
        seen.add(obj_id)
        cleaned = [clean_for_json(item, seen) for item in data]
        seen.discard(obj_id)
        return cleaned

    if hasattr(data, "_pb") and hasattr(data._pb, "ListFields"):
        try:
            return clean_for_json(_protobuf_to_dict(data._pb), seen)
        except Exception:
            return str(data)

    if hasattr(data, "ListFields"):
        try:
            return clean_for_json(_protobuf_to_dict(data), seen)
        except Exception:
            return str(data)

    if hasattr(data, "__dict__"):
        seen.add(obj_id)
        cleaned = {
            key: clean_for_json(value, seen)
            for key, value in vars(data).items()
            if not key.startswith("_")
        }
        seen.discard(obj_id)
        return cleaned or str(data)

    return str(data)


def ensure_json_serializable(data: Any) -> Any:
    cleaned = clean_for_json(data)
    json.dumps(cleaned)
    return cleaned


def _protobuf_to_dict(message: Any) -> dict[str, Any]:
    result: dict[str, Any] = {}
    for field_descriptor, value in message.ListFields():
        name = field_descriptor.name
        if field_descriptor.label == field_descriptor.LABEL_REPEATED:
            result[name] = [_protobuf_value_to_python(item) for item in value]
        else:
            result[name] = _protobuf_value_to_python(value)
    return result


def _protobuf_value_to_python(value: Any) -> Any:
    if hasattr(value, "ListFields"):
        return _protobuf_to_dict(value)
    return value
