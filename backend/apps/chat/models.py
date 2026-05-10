from django.db import models
from django.conf import settings

from apps.pharmacies.models import Pharmacy


class ChatMessage(models.Model):
    ROLE_CHOICES = [
        ("customer", "Customer"),
        ("patient", "Patient"),
        ("pharmacy", "Pharmacy"),
    ]

    pharmacy = models.ForeignKey(
        Pharmacy,
        related_name="messages",
        on_delete=models.SET_NULL,
        blank=True,
        null=True,
    )
    sender_pharmacy = models.ForeignKey(
        Pharmacy,
        related_name="sent_messages",
        on_delete=models.SET_NULL,
        blank=True,
        null=True,
    )
    recipient_user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        related_name="received_chat_messages",
        on_delete=models.SET_NULL,
        blank=True,
        null=True,
    )
    sender_user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        related_name="sent_chat_messages",
        on_delete=models.SET_NULL,
        blank=True,
        null=True,
    )
    sender_name = models.CharField(max_length=120)
    sender_role = models.CharField(max_length=20, choices=ROLE_CHOICES, default="customer")
    message = models.TextField()
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["created_at"]

    def __str__(self) -> str:
        return f"{self.sender_name}: {self.message[:30]}"
