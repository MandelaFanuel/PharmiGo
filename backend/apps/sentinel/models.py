from django.conf import settings
from django.db import models


class PharmiGoBugReport(models.Model):
    SEVERITY_CHOICES = [
        ("critical", "Critique"),
        ("warning", "Avertissement"),
        ("info", "Info"),
    ]
    STATUS_CHOICES = [
        ("new", "Nouveau"),
        ("in_progress", "En cours de correction"),
        ("resolved", "Résolu"),
    ]

    error_type = models.CharField(max_length=255)
    message = models.TextField(blank=True, default="")
    severity = models.CharField(max_length=20, choices=SEVERITY_CHOICES, default="critical")
    status = models.CharField(max_length=20, choices=STATUS_CHOICES, default="new")
    module = models.CharField(max_length=80, blank=True, default="")
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="sentinel_bug_reports",
    )
    actor_label = models.CharField(max_length=255, blank=True, default="")
    path = models.CharField(max_length=255)
    method = models.CharField(max_length=16, blank=True, default="")
    request_data = models.JSONField(default=dict, blank=True)
    traceback = models.TextField(blank=True, default="")
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["-created_at"]
        indexes = [
            models.Index(fields=["created_at"]),
            models.Index(fields=["severity"]),
            models.Index(fields=["status"]),
            models.Index(fields=["module"]),
        ]

    def __str__(self) -> str:
        return f"{self.error_type} [{self.severity}] {self.path}"

