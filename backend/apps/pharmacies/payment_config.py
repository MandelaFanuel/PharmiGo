from __future__ import annotations

from copy import deepcopy
from decimal import Decimal
from typing import Any


DEFAULT_PAYMENT_METHODS = [
    {
        "code": "lumicash",
        "label": "Lumicash",
        "currency": "BIF",
        "enabled": True,
        "account_name": "Ntakirutimana Fanuel",
        "account_number": "+25769096758",
        "instructions": "Utilisez la reference du mois de paiement lors du transfert.",
    },
    {
        "code": "ecocash",
        "label": "EcoCash",
        "currency": "BIF",
        "enabled": True,
        "account_name": "Ntakirutimana Fanuel",
        "account_number": "+25779177260",
        "instructions": "Envoyez ensuite la preuve de paiement dans votre dashboard.",
    },
    {
        "code": "vodacom_m_pesa",
        "label": "Vodacom M-Pesa",
        "currency": "USD",
        "enabled": True,
        "account_name": "PharmiGo",
        "account_number": "",
        "instructions": "Disponible pour les paiements USD depuis la RDC.",
    },
]


def get_default_payment_methods() -> list[dict[str, Any]]:
    return deepcopy(DEFAULT_PAYMENT_METHODS)


def sanitize_payment_methods(raw_methods: Any) -> list[dict[str, Any]]:
    if not isinstance(raw_methods, list):
        return get_default_payment_methods()

    normalized: list[dict[str, Any]] = []
    for index, item in enumerate(raw_methods):
        if not isinstance(item, dict):
            continue

        code = str(item.get("code") or f"manual_{index + 1}").strip().lower().replace(" ", "_")
        label = str(item.get("label") or code.replace("_", " ").title()).strip()
        currency = str(item.get("currency") or "BIF").strip().upper()
        account_name = str(item.get("account_name") or "").strip()
        account_number = str(item.get("account_number") or "").strip()
        instructions = str(item.get("instructions") or "").strip()
        enabled = bool(item.get("enabled", True))

        if not code or not label:
            continue

        normalized.append(
            {
                "code": code[:40],
                "label": label[:120],
                "currency": currency[:10],
                "enabled": enabled,
                "account_name": account_name[:120],
                "account_number": account_number[:80],
                "instructions": instructions[:255],
            }
        )

    return normalized or get_default_payment_methods()


def build_payment_details(settings_obj, exchange_snapshot: dict[str, Any] | float) -> dict[str, Any]:
    if isinstance(exchange_snapshot, dict):
        exchange_rate = float(exchange_snapshot.get("rate") or 0)
        exchange_rate_source = str(exchange_snapshot.get("source_label") or "").strip()
        exchange_rate_source_url = str(exchange_snapshot.get("source_url") or "").strip()
        exchange_rate_updated_at = exchange_snapshot.get("updated_at")
        exchange_rate_next_update_at = exchange_snapshot.get("next_update_at")
    else:
        exchange_rate = float(exchange_snapshot)
        exchange_rate_source = ""
        exchange_rate_source_url = ""
        exchange_rate_updated_at = None
        exchange_rate_next_update_at = None

    monthly_price_usd = Decimal(str(settings_obj.monthly_price_usd))
    monthly_price_bif = round(float(monthly_price_usd) * float(exchange_rate), 2)
    payment_methods = sanitize_payment_methods(getattr(settings_obj, "payment_methods", None))

    return {
        "monthly_price_usd": float(monthly_price_usd),
        "monthly_price_bif": monthly_price_bif,
        "exchange_rate": float(exchange_rate),
        "exchange_rate_source": exchange_rate_source,
        "exchange_rate_source_url": exchange_rate_source_url,
        "exchange_rate_updated_at": exchange_rate_updated_at,
        "exchange_rate_next_update_at": exchange_rate_next_update_at,
        "payment_methods": payment_methods,
    }
