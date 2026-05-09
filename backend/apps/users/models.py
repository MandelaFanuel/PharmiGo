from datetime import timedelta

from django.conf import settings
from django.db import models
from django.utils import timezone

from apps.common.public_storage import public_media_storage
from apps.pharmacies.models import Pharmacy


class UserProfile(models.Model):
    ROLE_CHOICES = [
        ("patient", "Patient"),
        ("pharmacy", "Pharmacy"),
        ("admin", "Admin"),
    ]

    user = models.OneToOneField(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="profile")
    role = models.CharField(max_length=20, choices=ROLE_CHOICES, default="patient")
    phone_number = models.CharField(max_length=30, blank=True)
    whatsapp_number = models.CharField(max_length=30, blank=True)
    birth_date = models.DateField(blank=True, null=True)
    gender = models.CharField(max_length=20, blank=True, default="")
    address = models.CharField(max_length=255, blank=True)
    profile_image = models.ImageField(upload_to="profiles/", storage=public_media_storage, blank=True, null=True)
    last_known_ip = models.GenericIPAddressField(blank=True, null=True)
    latitude = models.FloatField(blank=True, null=True)
    longitude = models.FloatField(blank=True, null=True)
    location_city = models.CharField(max_length=120, blank=True, default="")
    location_country = models.CharField(max_length=120, blank=True, default="")
    is_online = models.BooleanField(default=False)
    last_seen = models.DateTimeField(blank=True, null=True)
    presence_connections = models.PositiveIntegerField(default=0)
    pharmacy = models.OneToOneField(
        Pharmacy,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="user_profile",
    )
    created_at = models.DateTimeField(auto_now_add=True)
    email_verified = models.BooleanField(default=False)
    google_sub = models.CharField(max_length=255, blank=True, default="")

    class Meta:
        ordering = ["-created_at"]
        constraints = [
            models.UniqueConstraint(
                fields=["phone_number"],
                condition=~models.Q(phone_number=""),
                name="users_profile_phone_unique_non_blank",
            ),
        ]

    def __str__(self) -> str:
        return f"{self.user.username} ({self.role})"

    def mark_online(self) -> None:
        self.presence_connections = (self.presence_connections or 0) + 1
        self.is_online = True
        self.last_seen = timezone.now()
        self.save(update_fields=["presence_connections", "is_online", "last_seen"])

    def touch_presence(self) -> None:
        self.is_online = True
        self.last_seen = timezone.now()
        self.save(update_fields=["is_online", "last_seen"])

    def mark_offline(self) -> None:
        next_connections = max((self.presence_connections or 0) - 1, 0)
        self.presence_connections = next_connections
        self.is_online = next_connections > 0
        self.last_seen = timezone.now()
        self.save(update_fields=["presence_connections", "is_online", "last_seen"])

    def force_offline(self) -> None:
        self.presence_connections = 0
        self.is_online = False
        self.last_seen = timezone.now()
        self.save(update_fields=["presence_connections", "is_online", "last_seen"])

    def is_considered_online(self, grace_seconds: int = 20) -> bool:
        if not self.is_online or self.last_seen is None:
            return False
        return self.last_seen >= timezone.now() - timedelta(seconds=grace_seconds)


class EmailVerificationToken(models.Model):
    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="email_verification_tokens")
    token_hash = models.CharField(max_length=64, unique=True)
    expires_at = models.DateTimeField()
    used_at = models.DateTimeField(blank=True, null=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-created_at"]

    def __str__(self) -> str:
        return f"Email verification token for user {self.user_id}"
