from django.conf import settings
from django.db import models
from django.contrib.auth.models import User
from django.utils import timezone
from decimal import Decimal

from .payment_config import get_default_payment_methods


class Pharmacy(models.Model):
    name = models.CharField(max_length=255)
    profile_image = models.ImageField(upload_to="pharmacies/", blank=True, null=True)
    city = models.CharField(max_length=120)
    address = models.CharField(max_length=255)
    phone_number = models.CharField(max_length=30)
    email = models.EmailField(blank=True)
    opening_hours = models.CharField(max_length=120, default="08:00 - 20:00")
    delivery_supported = models.BooleanField(default=False)
    latitude = models.FloatField(blank=True, null=True)
    longitude = models.FloatField(blank=True, null=True)
    is_active = models.BooleanField(default=True)
    is_verified = models.BooleanField(default=False)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["name"]

    def __str__(self) -> str:
        return self.name

# Contact management between pharmacies
class PharmacyContact(models.Model):
    """Represents a bidirectional contact relationship between two pharmacies."""
    pharmacy = models.ForeignKey(
        Pharmacy,
        related_name="contacts",
        on_delete=models.CASCADE,
    )
    contact_pharmacy = models.ForeignKey(
        Pharmacy,
        related_name="contacted_by",
        on_delete=models.CASCADE,
    )
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        unique_together = ("pharmacy", "contact_pharmacy")
        ordering = ["-created_at"]

    def __str__(self) -> str:
        return f"{self.pharmacy.name} ↔ {self.contact_pharmacy.name}"


class PharmacyEngagement(models.Model):
    pharmacy = models.ForeignKey(
        Pharmacy,
        related_name="engagements",
        on_delete=models.CASCADE,
    )
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        related_name="pharmacy_engagements",
        on_delete=models.CASCADE,
    )
    liked = models.BooleanField(default=False)
    shared_at = models.DateTimeField(blank=True, null=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["-updated_at"]
        constraints = [
            models.UniqueConstraint(fields=["pharmacy", "user"], name="unique_pharmacy_engagement_user"),
        ]

    def mark_shared(self):
        if self.shared_at is None:
            self.shared_at = timezone.now()


class PharmacyComment(models.Model):
    pharmacy = models.ForeignKey(
        Pharmacy,
        related_name="comments",
        on_delete=models.CASCADE,
    )
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        related_name="pharmacy_comments",
        on_delete=models.CASCADE,
    )
    body = models.TextField()
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["created_at"]


class PharmacySubscription(models.Model):
    """Subscription model for pharmacies"""
    SUBSCRIPTION_STATUS_CHOICES = [
        ("trial", "Essai"),
        ("active", "Actif"),
        ("expired", "Expiré"),
        ("suspended", "Suspendu"),
        ("cancelled", "Annulé"),
    ]
    
    pharmacy = models.OneToOneField(
        Pharmacy,
        related_name="subscription",
        on_delete=models.CASCADE,
    )
    trial_start_date = models.DateTimeField(auto_now_add=True)
    trial_end_date = models.DateTimeField()
    is_trial_active = models.BooleanField(default=True)
    subscription_status = models.CharField(
        max_length=20,
        choices=SUBSCRIPTION_STATUS_CHOICES,
        default="trial"
    )
    monthly_price_usd = models.DecimalField(max_digits=10, decimal_places=2, default=5.00)
    current_exchange_rate_bif = models.DecimalField(max_digits=10, decimal_places=2, default=2850.00)
    monthly_price_bif = models.DecimalField(max_digits=15, decimal_places=2, blank=True, null=True)
    last_payment_date = models.DateTimeField(blank=True, null=True)
    next_payment_due_date = models.DateTimeField(blank=True, null=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)
    
    def __str__(self) -> str:
        return f"{self.pharmacy.name} - {self.subscription_status}"
    
    def save(self, *args, **kwargs):
        # Calculate BIF price based on exchange rate
        if self.monthly_price_bif is None:
            monthly_price = self.monthly_price_usd if isinstance(self.monthly_price_usd, Decimal) else Decimal(str(self.monthly_price_usd))
            exchange_rate = self.current_exchange_rate_bif if isinstance(self.current_exchange_rate_bif, Decimal) else Decimal(str(self.current_exchange_rate_bif))
            self.monthly_price_bif = monthly_price * exchange_rate
        
        # Set trial end date to 6 months from start if not set
        if self.trial_end_date is None and self.trial_start_date:
            from datetime import timedelta
            self.trial_end_date = self.trial_start_date + timedelta(days=30)
        
        super().save(*args, **kwargs)
    
    def is_active(self):
        """Check if subscription is active (trial or paid)"""
        if self.subscription_status == "trial" and self.is_trial_active:
            return timezone.now() <= self.trial_end_date
        return self.subscription_status == "active"


class SubscriptionSystemSettings(models.Model):
    """Global settings for pharmacy subscriptions."""

    trial_period_days = models.PositiveIntegerField(default=30)
    monthly_price_usd = models.DecimalField(max_digits=10, decimal_places=2, default=5.00)
    payment_methods = models.JSONField(default=get_default_payment_methods)
    updated_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        related_name="subscription_system_settings_updates",
        on_delete=models.SET_NULL,
        blank=True,
        null=True,
    )
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        verbose_name = "Subscription system settings"
        verbose_name_plural = "Subscription system settings"

    def __str__(self) -> str:
        return f"Trial: {self.trial_period_days} days | Monthly: {self.monthly_price_usd} USD"

    @classmethod
    def get_solo(cls):
        settings_obj, _ = cls.objects.get_or_create(pk=1)
        if settings_obj.trial_period_days == 180 and settings_obj.updated_by_id is None:
            settings_obj.trial_period_days = 30
            settings_obj.save(update_fields=["trial_period_days", "updated_at"])
        return settings_obj


class SubscriptionPayment(models.Model):
    """Payment model for pharmacy subscriptions"""
    PAYMENT_STATUS_CHOICES = [
        ("pending", "En attente"),
        ("verified", "Vérifié"),
        ("rejected", "Rejeté"),
    ]
    
    PAYMENT_METHOD_CHOICES = [
        ("lumicash", "Lumicash"),
        ("ecocash", "EcoCash"),
        ("vodacom_m_pesa", "Vodacom M-Pesa"),
    ]
    
    CURRENCY_CHOICES = [
        ("USD", "USD"),
        ("BIF", "BIF"),
    ]
    
    pharmacy = models.ForeignKey(
        Pharmacy,
        related_name="payments",
        on_delete=models.CASCADE,
    )
    amount_usd = models.DecimalField(max_digits=10, decimal_places=2)
    amount_bif = models.DecimalField(max_digits=15, decimal_places=2)
    currency = models.CharField(max_length=3, choices=CURRENCY_CHOICES, default="BIF")
    payment_method = models.CharField(max_length=20, choices=PAYMENT_METHOD_CHOICES)
    payer_name = models.CharField(max_length=120, blank=True, default="")
    payer_address = models.CharField(max_length=255, blank=True, default="")
    sender_phone = models.CharField(max_length=30)
    receiver_phone = models.CharField(max_length=30)
    transaction_reference = models.CharField(max_length=100, unique=True)
    payment_status = models.CharField(
        max_length=20,
        choices=PAYMENT_STATUS_CHOICES,
        default="pending"
    )
    proof_image = models.ImageField(upload_to="payment_proofs/", blank=True, null=True)
    payment_month = models.DateField()
    created_at = models.DateTimeField(auto_now_add=True)
    verified_at = models.DateTimeField(blank=True, null=True)
    verified_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        related_name="verified_payments",
        on_delete=models.SET_NULL,
        blank=True,
        null=True,
    )
    
    def __str__(self) -> str:
        return f"{self.pharmacy.name} - {self.payment_status} - {self.amount_bif} BIF"
    
    class Meta:
        ordering = ["-created_at"]
