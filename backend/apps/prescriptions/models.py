from django.conf import settings
from django.db import models
from django.utils import timezone
import uuid

from apps.common.storage import private_prescription_storage
from apps.pharmacies.models import Pharmacy


class Prescription(models.Model):
    STATUS_CHOICES = [
        ("uploaded", "Uploadée"),
        ("analyzing", "Analyse en cours"),
        ("confirmation_pending", "Confirmation en attente"),
        ("confirmed", "Confirmée"),
        ("searching", "Recherche pharmacies"),
        ("pharmacy_selected", "Pharmacie sélectionnée"),
        ("preparing", "En préparation"),
        ("ready", "Prête"),
        ("served", "Servie"),
        ("patient_confirmed", "Confirmée patient"),
        ("completed", "Terminée"),
        ("cancelled", "Annulée"),
        ("error", "Erreur"),
        # Legacy statuses for backward compatibility
        ("submitted", "Submitted"),
        ("reviewed", "Reviewed"),
    ]

    patient_name = models.CharField(max_length=255)
    patient_email = models.EmailField()
    public_reference = models.CharField(max_length=36, unique=True, blank=True, null=True, db_index=True)
    geo_zone = models.CharField(max_length=120, blank=True, default="")
    patient_user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        related_name="prescriptions",
        on_delete=models.SET_NULL,
        blank=True,
        null=True,
    )
    # Legacy fields for backward compatibility
    medication_name = models.CharField(max_length=255, blank=True, null=True)
    dosage = models.CharField(max_length=100, blank=True, null=True)
    instructions = models.TextField(blank=True, null=True)
    
    # New AI/OCR fields
    prescription_image = models.ImageField(upload_to="prescriptions/images/", blank=True, null=True)
    prescription_file = models.FileField(upload_to="prescriptions/files/", blank=True, null=True)
    private_document_name = models.CharField(max_length=255, blank=True, default="")
    private_document_original_name = models.CharField(max_length=255, blank=True, default="")
    document_content_type = models.CharField(max_length=120, blank=True, default="")
    ocr_text = models.TextField(blank=True, null=True)
    confidence_score = models.FloatField(default=0.0)
    
    pharmacy = models.ForeignKey(
        Pharmacy,
        related_name="prescriptions",
        on_delete=models.SET_NULL,
        blank=True,
        null=True,
    )
    status = models.CharField(max_length=50, choices=STATUS_CHOICES, default="uploaded")
    
    # New timestamp fields
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)
    served_at = models.DateTimeField(blank=True, null=True)
    patient_confirmed_at = models.DateTimeField(blank=True, null=True)
    
    # Additional fields for intelligent system
    total_amount = models.DecimalField(max_digits=10, decimal_places=2, null=True, blank=True)
    notes = models.TextField(blank=True, null=True)
    estimated_arrival = models.DateTimeField(blank=True, null=True)

    class Meta:
        ordering = ["-created_at"]

    def __str__(self) -> str:
        return f"{self.patient_name} - {self.public_reference or self.id}"

    def save(self, *args, **kwargs):
        if not self.public_reference:
            self.public_reference = self.build_public_reference()
        super().save(*args, **kwargs)

    @staticmethod
    def build_public_reference() -> str:
        return str(uuid.uuid4())

    def get_public_patient_alias(self) -> str:
        token = (self.public_reference or "").replace("-", "")[:8].upper()
        return f"Patient {token}" if token else "Patient"

    def get_document_name(self) -> str:
        if self.private_document_name:
            return self.private_document_name
        if self.prescription_file and getattr(self.prescription_file, "name", ""):
            return self.prescription_file.name
        if self.prescription_image and getattr(self.prescription_image, "name", ""):
            return self.prescription_image.name
        return ""

    def get_document_original_name(self) -> str:
        if self.private_document_original_name:
            return self.private_document_original_name
        if self.prescription_file and getattr(self.prescription_file, "name", ""):
            return self.prescription_file.name.rsplit("/", 1)[-1]
        if self.prescription_image and getattr(self.prescription_image, "name", ""):
            return self.prescription_image.name.rsplit("/", 1)[-1]
        return "ordonnance"

    def get_private_document_path(self) -> str | None:
        if self.private_document_name and private_prescription_storage.exists(self.private_document_name):
            try:
                return private_prescription_storage.path(self.private_document_name)
            except Exception:
                return None
        if self.prescription_image:
            try:
                return self.prescription_image.path
            except Exception:
                return None
        if self.prescription_file:
            try:
                return self.prescription_file.path
            except Exception:
                return None
        return None

    def has_private_document(self) -> bool:
        return bool(self.get_private_document_path())


class PrescriptionAnalysisTask(models.Model):
    STATUS_CHOICES = [
        ("queued", "Queued"),
        ("processing", "Processing"),
        ("completed", "Completed"),
        ("needs_confirmation", "Needs confirmation"),
        ("failed", "Failed"),
    ]

    task_id = models.UUIDField(default=uuid.uuid4, editable=False, unique=True)
    prescription = models.ForeignKey(
        Prescription,
        related_name="analysis_tasks",
        on_delete=models.CASCADE,
    )
    status = models.CharField(max_length=32, choices=STATUS_CHOICES, default="queued")
    raw_ocr_text = models.TextField(blank=True, null=True)
    raw_gemini_text = models.TextField(blank=True, null=True)
    ocr_payload = models.JSONField(default=dict, blank=True)
    gemini_payload = models.JSONField(default=dict, blank=True)
    analysis_payload = models.JSONField(default=list, blank=True)
    global_score = models.FloatField(default=0.0)
    needs_confirmation = models.BooleanField(default=True)
    error_message = models.TextField(blank=True, null=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)
    completed_at = models.DateTimeField(blank=True, null=True)

    class Meta:
        ordering = ["-created_at"]

    def __str__(self) -> str:
        return f"{self.task_id} - {self.status}"


class AnalysisLog(models.Model):
    LEVEL_CHOICES = [
        ("info", "Info"),
        ("warning", "Warning"),
        ("error", "Error"),
    ]

    task = models.ForeignKey(
        PrescriptionAnalysisTask,
        related_name="logs",
        on_delete=models.CASCADE,
        blank=True,
        null=True,
    )
    prescription = models.ForeignKey(
        Prescription,
        related_name="analysis_logs",
        on_delete=models.CASCADE,
        blank=True,
        null=True,
    )
    stage = models.CharField(max_length=64)
    level = models.CharField(max_length=16, choices=LEVEL_CHOICES, default="info")
    message = models.TextField()
    payload = models.JSONField(default=dict, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-created_at"]

    def __str__(self) -> str:
        return f"{self.stage} [{self.level}]"


class PrescriptionResponse(models.Model):
    STATUS_CHOICES = [
        ("pending", "Pending"),
        ("quoted", "Quoted"),
        ("confirmed", "Confirmed"),
    ]

    prescription = models.ForeignKey(
        Prescription,
        related_name="responses",
        on_delete=models.CASCADE,
    )
    pharmacy = models.ForeignKey(
        Pharmacy,
        related_name="responses",
        on_delete=models.CASCADE,
    )
    responder_name = models.CharField(max_length=120)
    availability_note = models.TextField()
    estimated_minutes = models.PositiveIntegerField(default=30)
    total_price = models.DecimalField(max_digits=10, decimal_places=2, default=0)
    status = models.CharField(max_length=20, choices=STATUS_CHOICES, default="quoted")
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-created_at"]

    def __str__(self) -> str:
        return f"{self.pharmacy.name} -> {self.prescription.medication_name}"


class PrescriptionEngagement(models.Model):
    prescription = models.ForeignKey(
        Prescription,
        related_name="engagements",
        on_delete=models.CASCADE,
    )
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        related_name="prescription_engagements",
        on_delete=models.CASCADE,
        blank=True,
        null=True,
    )
    pharmacy = models.ForeignKey(
        Pharmacy,
        related_name="prescription_engagements",
        on_delete=models.CASCADE,
        blank=True,
        null=True,
    )
    liked = models.BooleanField(default=False)
    shared_at = models.DateTimeField(blank=True, null=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["-updated_at"]
        constraints = [
            models.UniqueConstraint(fields=["prescription", "pharmacy"], name="unique_prescription_engagement"),
            models.UniqueConstraint(fields=["prescription", "user"], name="unique_prescription_engagement_user"),
        ]

    def mark_shared(self):
        if self.shared_at is None:
            self.shared_at = timezone.now()

    def __str__(self) -> str:
        actor = self.pharmacy.name if self.pharmacy_id else (self.user.username if self.user_id else "Utilisateur")
        return f"{actor} engagement on {self.prescription.medication_name}"


class PrescriptionComment(models.Model):
    prescription = models.ForeignKey(
        Prescription,
        related_name="comments",
        on_delete=models.CASCADE,
    )
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        related_name="prescription_comments",
        on_delete=models.CASCADE,
    )
    body = models.TextField()
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["created_at"]

    def __str__(self) -> str:
        return f"Comment by {self.user.username} on {self.prescription.medication_name}"


class MedicationExtraction(models.Model):
    """Model to store extracted medications from OCR analysis"""
    prescription = models.ForeignKey(
        Prescription,
        related_name="extracted_medications",
        on_delete=models.CASCADE,
    )
    name = models.CharField(max_length=255)
    generic_name = models.CharField(max_length=255, blank=True, null=True)
    dosage = models.CharField(max_length=100, blank=True, null=True)
    form = models.CharField(max_length=100, blank=True, null=True)
    quantity = models.IntegerField(default=1)
    unit = models.CharField(max_length=50, default="comprimés")
    posology = models.TextField(blank=True, null=True)
    confidence = models.FloatField(default=0.0)
    confirmed = models.BooleanField(default=False)
    alternatives = models.JSONField(default=list, blank=True)
    requires_prescription = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)
    
    class Meta:
        ordering = ["-confidence"]
    
    def __str__(self) -> str:
        return f"{self.name} ({self.dosage}) - {self.confidence:.2%}"


class PrescriptionStatusHistory(models.Model):
    """Track status changes for audit trail"""
    prescription = models.ForeignKey(
        Prescription,
        related_name="status_history",
        on_delete=models.CASCADE,
    )
    status = models.CharField(max_length=50)
    changed_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        related_name="prescription_status_changes",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
    )
    changed_at = models.DateTimeField(auto_now_add=True)
    notes = models.TextField(blank=True, null=True)
    
    class Meta:
        ordering = ["-changed_at"]
    
    def __str__(self) -> str:
        return f"{self.prescription.id} -> {self.status} at {self.changed_at}"


class PharmacyStock(models.Model):
    """Track medication stock in each pharmacy"""
    CURRENCY_CHOICES = [
        ("BIF", "BIF"),
        ("FC", "FC"),
        ("TSH", "TSH"),
    ]

    pharmacy = models.ForeignKey(
        Pharmacy,
        related_name="stock",
        on_delete=models.CASCADE,
    )
    medication_name = models.CharField(max_length=255)
    generic_name = models.CharField(max_length=255, blank=True, null=True)
    dosage = models.CharField(max_length=100, blank=True, null=True)
    quantity = models.IntegerField(default=0)
    unit = models.CharField(max_length=50, default="comprimés")
    price = models.DecimalField(max_digits=10, decimal_places=2, default=0.00)
    currency = models.CharField(max_length=4, choices=CURRENCY_CHOICES, default="BIF")
    last_updated = models.DateTimeField(auto_now=True)
    is_available = models.BooleanField(default=True)
    
    class Meta:
        ordering = ["-last_updated"]
        unique_together = ["pharmacy", "medication_name", "dosage"]
    
    def __str__(self) -> str:
        return f"{self.pharmacy.name} - {self.medication_name} ({self.quantity})"


class PrescriptionRecommendation(models.Model):
    AVAILABILITY_CHOICES = [
        ("complete", "Complete"),
        ("partial", "Partial"),
    ]

    prescription = models.ForeignKey(
        Prescription,
        related_name="recommendations",
        on_delete=models.CASCADE,
    )
    pharmacy = models.ForeignKey(
        Pharmacy,
        related_name="prescription_recommendations",
        on_delete=models.CASCADE,
    )
    availability = models.CharField(max_length=20, choices=AVAILABILITY_CHOICES)
    matched_items = models.JSONField(default=list, blank=True)
    missing_items = models.JSONField(default=list, blank=True)
    estimated_total_price = models.DecimalField(max_digits=12, decimal_places=2, default=0.00)
    distance_km = models.FloatField(blank=True, null=True)
    score = models.FloatField(default=0.0)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["-score", "distance_km", "pharmacy__name"]
        unique_together = ["prescription", "pharmacy"]

    def __str__(self) -> str:
        return f"{self.prescription_id} -> {self.pharmacy.name} ({self.availability})"
