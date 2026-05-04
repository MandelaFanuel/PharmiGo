from __future__ import annotations

import ipaddress
import json
from dataclasses import dataclass
from typing import Any
from urllib.error import URLError
from urllib.request import urlopen


DEFAULT_GEOIP_TIMEOUT_SECONDS = 2.5


@dataclass
class LocationSnapshot:
    ip_address: str
    latitude: float | None = None
    longitude: float | None = None
    city: str = ""
    country: str = ""


def extract_client_ip(request) -> str | None:
    forwarded_for = str(request.META.get("HTTP_X_FORWARDED_FOR") or "").strip()
    if forwarded_for:
        first_hop = forwarded_for.split(",")[0].strip()
        if first_hop:
            return first_hop

    real_ip = str(request.META.get("HTTP_X_REAL_IP") or "").strip()
    if real_ip:
        return real_ip

    remote_addr = str(request.META.get("REMOTE_ADDR") or "").strip()
    return remote_addr or None


def is_public_ip(ip_address: str | None) -> bool:
    if not ip_address:
        return False

    try:
        parsed = ipaddress.ip_address(ip_address)
    except ValueError:
        return False

    return parsed.is_global


def lookup_location_from_ip(ip_address: str | None) -> LocationSnapshot | None:
    if not is_public_ip(ip_address):
        return None

    lookup_url = f"https://ipwho.is/{ip_address}"
    try:
        with urlopen(lookup_url, timeout=DEFAULT_GEOIP_TIMEOUT_SECONDS) as response:
            payload: dict[str, Any] = json.loads(response.read().decode("utf-8"))
    except (URLError, TimeoutError, OSError, ValueError, json.JSONDecodeError):
        return None

    if not payload.get("success", False):
        return None

    latitude = _coerce_float(payload.get("latitude"))
    longitude = _coerce_float(payload.get("longitude"))
    return LocationSnapshot(
        ip_address=ip_address or "",
        latitude=latitude,
        longitude=longitude,
        city=str(payload.get("city") or "").strip(),
        country=str(payload.get("country") or "").strip(),
    )


def refresh_profile_location_from_request(profile, request) -> None:
    ip_address = extract_client_ip(request)
    if not ip_address:
        return

    previous_ip = profile.last_known_ip
    updates: list[str] = []
    if previous_ip != ip_address:
        profile.last_known_ip = ip_address
        updates.append("last_known_ip")

    needs_lookup = previous_ip != ip_address or profile.latitude is None or profile.longitude is None

    if needs_lookup:
        snapshot = lookup_location_from_ip(ip_address)
        if snapshot is not None:
            if snapshot.latitude is not None and profile.latitude != snapshot.latitude:
                profile.latitude = snapshot.latitude
                updates.append("latitude")
            if snapshot.longitude is not None and profile.longitude != snapshot.longitude:
                profile.longitude = snapshot.longitude
                updates.append("longitude")
            if snapshot.city and profile.location_city != snapshot.city:
                profile.location_city = snapshot.city
                updates.append("location_city")
            if snapshot.country and profile.location_country != snapshot.country:
                profile.location_country = snapshot.country
                updates.append("location_country")

    if updates:
        profile.save(update_fields=list(dict.fromkeys(updates)))

    _sync_pharmacy_location_from_profile(profile)


def sync_profile_coordinates(
    profile,
    *,
    latitude: float | None,
    longitude: float | None,
    city: str = "",
    country: str = "",
) -> None:
    updates: list[str] = []

    if latitude is not None and profile.latitude != latitude:
        profile.latitude = latitude
        updates.append("latitude")
    if longitude is not None and profile.longitude != longitude:
        profile.longitude = longitude
        updates.append("longitude")
    if city and profile.location_city != city:
        profile.location_city = city
        updates.append("location_city")
    if country and profile.location_country != country:
        profile.location_country = country
        updates.append("location_country")

    if updates:
        profile.save(update_fields=list(dict.fromkeys(updates)))

    _sync_pharmacy_location_from_profile(profile)


def _coerce_float(value: Any) -> float | None:
    if isinstance(value, (int, float)):
        return float(value)
    if isinstance(value, str):
        try:
            return float(value)
        except ValueError:
            return None
    return None


def _sync_pharmacy_location_from_profile(profile) -> None:
    if getattr(profile, "role", None) != "pharmacy":
        return

    pharmacy = getattr(profile, "pharmacy", None)
    if pharmacy is None:
        return

    updates: list[str] = []
    if profile.latitude is not None and pharmacy.latitude != profile.latitude:
        pharmacy.latitude = profile.latitude
        updates.append("latitude")
    if profile.longitude is not None and pharmacy.longitude != profile.longitude:
        pharmacy.longitude = profile.longitude
        updates.append("longitude")
    if profile.location_city and pharmacy.city != profile.location_city:
        pharmacy.city = profile.location_city[:120]
        updates.append("city")

    if updates:
        pharmacy.save(update_fields=list(dict.fromkeys(updates)))
