"""Exchange Rate Service for USD/BIF conversion"""

from datetime import datetime, timedelta
import json
from urllib.error import URLError
from urllib.request import urlopen

from django.conf import settings
from django.core.cache import cache

try:
    import requests
except ImportError:  # pragma: no cover - environment dependent
    requests = None


class ExchangeRateService:
    """Service to fetch and manage USD/BIF exchange rates"""
    
    DEFAULT_RATE = 2850.00  # Default fallback rate
    CACHE_KEY = "usd_bif_exchange_rate"
    CACHE_TIMEOUT = 86400  # Cache for 24 hours (in seconds)
    
    # API endpoints for exchange rates
    EXCHANGE_RATE_APIS = [
        "https://api.exchangerate-api.com/v4/latest/USD",
        "https://open.er-api.com/v6/latest/USD",
    ]
    
    def __init__(self):
        pass
    
    def get_exchange_rate(self) -> float:
        """
        Get current USD/BIF exchange rate from cache or API
        
        Returns:
            Exchange rate as float (BIF per 1 USD)
        """
        # Try to get from cache first
        cached_rate = cache.get(self.CACHE_KEY)
        if cached_rate:
            return cached_rate
        
        # Fetch from API
        rate = self._fetch_from_api()
        
        if rate:
            # Cache the rate
            cache.set(self.CACHE_KEY, rate, self.CACHE_TIMEOUT)
            return rate
        
        # Return default rate if API fails
        return self.DEFAULT_RATE
    
    def _fetch_from_api(self) -> float:
        """
        Fetch exchange rate from external APIs
        
        Returns:
            Exchange rate as float, or None if all APIs fail
        """
        for api_url in self.EXCHANGE_RATE_APIS:
            try:
                data = self._load_api_payload(api_url)

                # Try different API response formats
                if "rates" in data and "BIF" in data["rates"]:
                    return float(data["rates"]["BIF"])
                elif "rates" in data and "bif" in data["rates"]:
                    return float(data["rates"]["bif"])

            except (ValueError, KeyError, OSError) as e:
                print(f"Failed to fetch from {api_url}: {str(e)}")
                continue
        
        return None

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
        
        cache.set(self.CACHE_KEY, new_rate, self.CACHE_TIMEOUT)
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
        
        return {
            "monthly_price_usd": monthly_price_usd,
            "monthly_price_bif": monthly_price_bif,
            "exchange_rate": rate,
            "exchange_rate_date": datetime.now(),
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
