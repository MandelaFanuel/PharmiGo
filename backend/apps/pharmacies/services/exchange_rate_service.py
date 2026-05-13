"""Exchange Rate Service for USD/BIF conversion"""

from datetime import datetime
import json
from urllib.request import urlopen
from urllib.parse import urlparse

from django.conf import settings
from django.core.cache import cache

try:
    import requests
except ImportError:  # pragma: no cover - environment dependent
    requests = None


class ExchangeRateService:
    """Service to fetch and manage USD/BIF exchange rates"""
    
    DEFAULT_RATE = 2850.00  # Default fallback rate
    CACHE_KEY = "usd_bif_exchange_snapshot"
    LEGACY_RATE_CACHE_KEY = "usd_bif_exchange_rate"
    CACHE_TIMEOUT = 300  # Cache for 5 minutes for near real-time transparency
    DEFAULT_SOURCE_LABEL = "PharmiGo fallback interne"
    DEFAULT_SOURCE_URL = ""
    
    # API endpoints for exchange rates
    EXCHANGE_RATE_APIS = [
        "https://api.exchangerate-api.com/v4/latest/USD",
        "https://open.er-api.com/v6/latest/USD",
    ]
    
    def __init__(self):
        pass
    
    def get_exchange_snapshot(self) -> dict:
        """Return the live USD/BIF exchange snapshot with source metadata."""
        cached_snapshot = cache.get(self.CACHE_KEY)
        if isinstance(cached_snapshot, dict) and cached_snapshot.get("rate"):
            return cached_snapshot

        snapshot = self._fetch_from_api()
        if snapshot:
            cache.set(self.CACHE_KEY, snapshot, self.CACHE_TIMEOUT)
            cache.set(self.LEGACY_RATE_CACHE_KEY, snapshot["rate"], self.CACHE_TIMEOUT)
            return snapshot

        return {
            "rate": float(self.DEFAULT_RATE),
            "source_label": self.DEFAULT_SOURCE_LABEL,
            "source_url": self.DEFAULT_SOURCE_URL,
            "updated_at": None,
            "next_update_at": None,
        }

    def get_exchange_rate(self) -> float:
        """Get the current exchange rate (BIF per 1 USD)."""
        return float(self.get_exchange_snapshot()["rate"])

    def _fetch_from_api(self) -> dict | None:
        """Fetch the USD/BIF exchange rate plus source metadata from external APIs."""
        for api_url in self.EXCHANGE_RATE_APIS:
            try:
                data = self._load_api_payload(api_url)
                rates = data.get("rates") or {}
                if "BIF" not in rates and "bif" not in rates:
                    continue
                raw_rate = rates.get("BIF", rates.get("bif"))
                rate = float(raw_rate)
                source_url = self._resolve_source_url(api_url, data)
                return {
                    "rate": rate,
                    "source_label": self._resolve_source_label(source_url),
                    "source_url": source_url,
                    "updated_at": data.get("time_last_update_utc") or data.get("time_last_updated") or data.get("date"),
                    "next_update_at": data.get("time_next_update_utc"),
                }
            except (ValueError, KeyError, OSError) as e:
                print(f"Failed to fetch from {api_url}: {str(e)}")
                continue
        
        return None

    def _resolve_source_url(self, api_url: str, data: dict) -> str:
        provider = data.get("provider")
        if isinstance(provider, str) and provider.startswith("http"):
            return provider
        documentation = data.get("documentation")
        if isinstance(documentation, str) and documentation.startswith("http"):
            return documentation
        return api_url

    def _resolve_source_label(self, source_url: str) -> str:
        parsed = urlparse(source_url)
        host = parsed.netloc.lower()
        if "exchangerate-api.com" in host:
            return "ExchangeRate-API"
        if host:
            return host.replace("www.", "")
        return self.DEFAULT_SOURCE_LABEL

    def _load_api_payload(self, api_url: str) -> dict:
        if requests is not None:
            response = requests.get(api_url, timeout=10)
            response.raise_for_status()
            return response.json()

        with urlopen(api_url, timeout=10) as response:
            payload = response.read().decode("utf-8")
        return json.loads(payload)
    
    def update_exchange_rate(self, new_rate: float) -> bool:
        """
        Manually update the exchange rate (admin function)
        
        Args:
            new_rate: New exchange rate (BIF per 1 USD)
            
        Returns:
            True if successful, False otherwise
        """
        if new_rate <= 0:
            return False
        
        snapshot = {
            "rate": float(new_rate),
            "source_label": "Mise a jour manuelle PharmiGo",
            "source_url": "",
            "updated_at": datetime.utcnow().isoformat(),
            "next_update_at": None,
        }
        cache.set(self.CACHE_KEY, snapshot, self.CACHE_TIMEOUT)
        cache.set(self.LEGACY_RATE_CACHE_KEY, float(new_rate), self.CACHE_TIMEOUT)
        return True
    
    def convert_usd_to_bif(self, amount_usd: float) -> float:
        """
        Convert USD to BIF using current exchange rate
        
        Args:
            amount_usd: Amount in USD
            
        Returns:
            Amount in BIF
        """
        rate = self.get_exchange_rate()
        return round(amount_usd * rate, 2)
    
    def get_payment_info_burundi(self) -> dict:
        """
        Get payment information for Burundi
        
        Returns:
            Dictionary with payment details
        """
        rate = self.get_exchange_rate()
        monthly_price_usd = 5.00
        monthly_price_bif = self.convert_usd_to_bif(monthly_price_usd)
        snapshot = self.get_exchange_snapshot()
        
        return {
            "monthly_price_usd": monthly_price_usd,
            "monthly_price_bif": monthly_price_bif,
            "exchange_rate": rate,
            "exchange_rate_date": datetime.now(),
            "exchange_rate_source": snapshot["source_label"],
            "exchange_rate_source_url": snapshot["source_url"],
            "exchange_rate_updated_at": snapshot["updated_at"],
            "lumicash_receiver": "+25769096758",
            "lumicash_receiver_name": "Ntakirutimana Fanuel",
            "ecocash_receiver": "+25779177260",
            "ecocash_receiver_name": "Ntakirutimana Fanuel",
        }
    
    def get_payment_info_usd(self) -> dict:
        """
        Get payment information for USD payments
        
        Returns:
            Dictionary with payment details
        """
        return {
            "monthly_price_usd": 5.00,
            "vodacom_m_pesa_receiver": getattr(settings, "VODACOM_MPESA_RECEIVER_PHONE", ""),
        }
