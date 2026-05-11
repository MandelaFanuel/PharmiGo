from django.conf import settings
from django.db import models
from django.contrib.auth.models import User
from django.utils import timezone
from decimal import Decimal

from apps.common.public_storage import public_media_storage
from .payment_config import get_default_payment_methods


class Pharmacy(models.Model):
    name = models.CharField(max_length=255)
    referral_code = models.CharField(max_length=24, unique=True, blank=True, default="")
    profile_image = models.ImageField(upload_to="pharmacies/", storage=public_media_storage, blank=True, null=True)
    profile_image_blob = models.BinaryField(blank=True, null=True, editable=False)
    profile_image_content_type = models.CharField(max_length=120, blank=True, default="")
    profile_image_original_name = models.CharField(max_length=255, blank=True, default="")
    city = models.CharField(max_length=120)
    address = models.CharField(max_length=255)
    phone_number = models.CharField(max_length=30)
    email = models.EmailField(blank=True)
    opening_hours = models.CharField(max_length=120, default="08:00 - 20:00")
    delivery_supported = models.BooleanField(default=False)
    wholesale_supported = models.BooleanField(default=False)
    retail_supported = models.BooleanField(default=True)
    latitude = models.FloatField(blank=True, null=True)
    longitude = models.FloatField(blank=True, null=True)
    is_active = models.BooleanField(default=True)
    is_verified = models.BooleanField(default=False)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["name"]

    def __str__(self) -> str:
        return self.name

    def save(self, *args, **kwargs):
        if not self.referral_code:
            base_token = "".join(char for char in (self.name or "PHARMIGO").upper() if char.isalnum())[:8] or "PHARMIGO"
            seed = f"{base_token}{(self.phone_number or '')[-4:]}"
            candidate = seed[:24]
            suffix = 1
            while Pharmacy.objects.exclude(pk=self.pk).filter(referral_code=candidate).exists():
                suffix += 1
                candidate = f"{seed[:18]}{suffix:02d}"[:24]
            self.referral_code = candidate
        super().save(*args, **kwargs)

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
        from .services.access import is_subscription_eligible

        return is_subscription_eligible(self)


class SubscriptionSystemSettings(models.Model):
    """Global settings for pharmacy subscriptions."""

    trial_period_days = models.PositiveIntegerField(default=30)
    monthly_price_usd = models.DecimalField(max_digits=10, decimal_places=2, default=5.00)
    payment_methods = models.JSONField(default=get_default_payment_methods)
    reward_event_start_date = models.DateTimeField(blank=True, null=True)
    reward_event_end_date = models.DateTimeField(blank=True, null=True)
    reward_referral_threshold = models.PositiveIntegerField(default=20)
    reward_min_activity_count = models.PositiveIntegerField(default=10)
    reward_device_daily_limit = models.PositiveIntegerField(default=3)
    reward_bonus_days = models.PositiveIntegerField(default=90)
    reward_instructions = models.TextField(
        blank=True,
        default=(
            "Programme ambassadeur PharmiGo\n\n"
            "1. Partagez votre lien de parrainage avec une autre pharmacie.\n"
            "2. La pharmacie filleule doit soumettre une preuve de paiement validee par l'admin.\n"
            "3. Elle doit ensuite traiter au moins 10 ordonnances reelles.\n"
            "4. Toute activite repetitive suspecte sur le meme appareil est bloquee et remontee a l'administration.\n"
            "5. A partir du seuil de validations configure, PharmiGo ajoute automatiquement des jours gratuits a votre abonnement."
        ),
    )
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


class PharmacyReferral(models.Model):
    STATUS_CHOICES = [
        ("pending_payment", "Attente Paiement"),
        ("pending_activity", "Attente Activite"),
        ("validated", "Valide"),
        ("rewarded", "Recompense accordee"),
        ("fraud_blocked", "Bloque fraude"),
    ]

    referrer = models.ForeignKey(
        Pharmacy,
        related_name="sent_referrals",
        on_delete=models.CASCADE,
    )
    referee = models.OneToOneField(
        Pharmacy,
        related_name="incoming_referral",
        on_delete=models.CASCADE,
    )
    status = models.CharField(max_length=24, choices=STATUS_CHOICES, default="pending_payment")
    payment_validated_at = models.DateTimeField(blank=True, null=True)
    payment_validated_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        related_name="validated_referrals",
        on_delete=models.SET_NULL,
        blank=True,
        null=True,
    )
    payment_reference = models.CharField(max_length=120, blank=True, default="")
    validated_activity_count = models.PositiveIntegerField(default=0)
    reward_granted_at = models.DateTimeField(blank=True, null=True)
    fraud_blocked_at = models.DateTimeField(blank=True, null=True)
    last_evaluated_at = models.DateTimeField(blank=True, null=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["-updated_at"]

    def __str__(self) -> str:
        return f"{self.referrer.name} -> {self.referee.name} ({self.status})"


class PharmacyReferralDeviceLog(models.Model):
    referral = models.ForeignKey(
        PharmacyReferral,
        related_name="device_logs",
        on_delete=models.CASCADE,
    )
    pharmacy = models.ForeignKey(
        Pharmacy,
        related_name="reward_device_logs",
        on_delete=models.CASCADE,
    )
    prescription_id = models.PositiveIntegerField()
    device_fingerprint = models.CharField(max_length=120)
    source_label = models.CharField(max_length=80, blank=True, default="")
    activity_date = models.DateField()
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-created_at"]
        constraints = [
            models.UniqueConstraint(
                fields=["referral", "prescription_id", "device_fingerprint", "activity_date"],
                name="unique_referral_prescription_device_day",
            ),
        ]


class PharmacyReferralFraudAlert(models.Model):
    STATUS_CHOICES = [
        ("open", "Ouverte"),
        ("reviewed", "Examinee"),
    ]

    referral = models.ForeignKey(
        PharmacyReferral,
        related_name="fraud_alerts",
        on_delete=models.CASCADE,
    )
    pharmacy = models.ForeignKey(
        Pharmacy,
        related_name="reward_fraud_alerts",
        on_delete=models.CASCADE,
    )
    device_fingerprint = models.CharField(max_length=120)
    repeated_dates = models.JSONField(default=list, blank=True)
    message = models.TextField()
    status = models.CharField(max_length=20, choices=STATUS_CHOICES, default="open")
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-created_at"]


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
