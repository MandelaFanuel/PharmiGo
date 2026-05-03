import re

from rest_framework import serializers


PHONE_DIGITS_RE = re.compile(r"[^\d+]")
SUPPORTED_PHONE_RE = re.compile(r"^\+(257\d{8}|243\d{9}|255\d{9})$")
UNSUPPORTED_PHONE_MESSAGE = "Ce numero n'est pas admis, veuillez contacter l'admin sur +25769096758"


def normalize_phone_number(value: str) -> str:
    raw_value = PHONE_DIGITS_RE.sub("", value or "").strip()
    if not raw_value:
        raise serializers.ValidationError("Le numero de telephone est obligatoire.")

    normalized = raw_value if raw_value.startswith("+") else f"+{raw_value}"

    if not SUPPORTED_PHONE_RE.fullmatch(normalized):
        raise serializers.ValidationError(UNSUPPORTED_PHONE_MESSAGE)

    return normalized
