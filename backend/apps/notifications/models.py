from django.conf import settings
from django.db import models

from apps.pharmacies.models import Pharmacy


class Notification(models.Model):
    title = models.CharField(max_length=120)
    message = models.TextField()
    channel = models.CharField(max_length=50, default="system")
    recipient_user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        null=True,
        blank=True,
        on_delete=models.CASCADE,
        related_name="notifications",
    )
    recipient_pharmacy = models.ForeignKey(
        Pharmacy,
        null=True,
        blank=True,
        on_delete=models.CASCADE,
        related_name="notifications",
    )
    is_read = models.BooleanField(default=False)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-created_at"]

    def __str__(self) -> str:
        return self.title
