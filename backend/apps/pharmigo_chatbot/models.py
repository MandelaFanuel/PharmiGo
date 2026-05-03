from django.conf import settings
from django.db import models

from apps.pharmacies.models import Pharmacy as RealPharmacy
from apps.prescriptions.models import Prescription as RealPrescription


class Pharmacy(models.Model):
    user = models.OneToOneField(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="pharmacy_profile"
    )
    name = models.CharField(max_length=255)
    address = models.TextField()
    phone = models.CharField(max_length=30, blank=True)
    is_active = models.BooleanField(default=True)

    def __str__(self):
        return self.name


class Medicine(models.Model):
    name = models.CharField(max_length=255)
    normalized_name = models.CharField(max_length=255, db_index=True)
    dosage = models.CharField(max_length=100, blank=True)
    form = models.CharField(max_length=100, blank=True)
    category = models.CharField(max_length=100, blank=True, db_index=True)
    is_active = models.BooleanField(default=True)

    def __str__(self):
        return f"{self.name} {self.dosage}".strip()


class MedicineSynonym(models.Model):
    """Synonymes et noms commerciaux pour les médicaments"""
    medicine = models.ForeignKey(Medicine, on_delete=models.CASCADE, related_name="synonyms")
    synonym = models.CharField(max_length=255, db_index=True)
    normalized_synonym = models.CharField(max_length=255, db_index=True)
    is_brand_name = models.BooleanField(default=False)

    class Meta:
        unique_together = ["medicine", "synonym"]

    def __str__(self):
        return f"{self.synonym} -> {self.medicine.name}"


class PharmacyStock(models.Model):
    pharmacy = models.ForeignKey(Pharmacy, on_delete=models.CASCADE, related_name="stocks")
    medicine = models.ForeignKey(Medicine, on_delete=models.CASCADE)
    quantity = models.PositiveIntegerField(default=0)
    price = models.DecimalField(max_digits=12, decimal_places=2, null=True, blank=True)
    updated_at = models.DateTimeField(auto_now=True)


class Prescription(models.Model):
    class Status(models.TextChoices):
        PUBLISHED = "published", "Publiée"
        NEEDS_CONFIRMATION = "needs_confirmation", "Confirmation nécessaire"
        ANALYZED = "analyzed", "Analysée"
        PHARMACY_SELECTED = "pharmacy_selected", "Pharmacie sélectionnée"
        WAITING_PATIENT_CONFIRMATION = "waiting_patient_confirmation", "En attente confirmation patient"
        SERVED = "served", "Déjà servie"
        CANCELLED = "cancelled", "Annulée"

    patient = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE)
    image = models.ImageField(upload_to="prescriptions/")
    status = models.CharField(max_length=50, choices=Status.choices, default=Status.PUBLISHED)

    selected_pharmacy = models.ForeignKey(
        Pharmacy,
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="selected_prescriptions"
    )

    extracted_text = models.TextField(blank=True)
    confidence_score = models.FloatField(default=0.0)

    selected_at = models.DateTimeField(null=True, blank=True)
    pharmacy_confirmed_at = models.DateTimeField(null=True, blank=True)
    patient_confirmed_at = models.DateTimeField(null=True, blank=True)
    served_at = models.DateTimeField(null=True, blank=True)

    created_at = models.DateTimeField(auto_now_add=True)


class PrescriptionItem(models.Model):
    prescription = models.ForeignKey(Prescription, on_delete=models.CASCADE, related_name="items")
    medicine_name = models.CharField(max_length=255)
    normalized_name = models.CharField(max_length=255, db_index=True)
    dosage = models.CharField(max_length=100, blank=True)
    form = models.CharField(max_length=100, blank=True)
    quantity = models.CharField(max_length=100, blank=True)
    posology = models.TextField(blank=True)
    confidence = models.FloatField(default=0.0)
    confirmed_by_patient = models.BooleanField(default=False)
    confirmed_by_pharmacy = models.BooleanField(default=False)


class PrescriptionHistory(models.Model):
    prescription = models.ForeignKey(Prescription, on_delete=models.CASCADE, related_name="history")
    action = models.CharField(max_length=100)
    actor = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True)
    pharmacy = models.ForeignKey(Pharmacy, on_delete=models.SET_NULL, null=True, blank=True)
    note = models.TextField(blank=True)
    metadata = models.JSONField(default=dict, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)


class ChatMessage(models.Model):
    class Sender(models.TextChoices):
        USER = "user", "Utilisateur"
        BOT = "bot", "Chatbot"

    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE)
    prescription = models.ForeignKey(Prescription, on_delete=models.SET_NULL, null=True, blank=True)
    sender = models.CharField(max_length=20, choices=Sender.choices)
    message = models.TextField()
    metadata = models.JSONField(default=dict, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)


class ChatbotKnowledgeBase(models.Model):
    ROLE_CHOICES = [
        ("patient", "Patient"),
        ("pharmacy", "Pharmacy"),
        ("all", "All"),
    ]

    question = models.CharField(max_length=255)
    answer = models.TextField()
    category = models.CharField(max_length=100, db_index=True)
    keywords = models.TextField(blank=True)
    role_target = models.CharField(max_length=20, choices=ROLE_CHOICES, default="all", db_index=True)
    is_active = models.BooleanField(default=True, db_index=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["category", "question"]

    def __str__(self):
        return f"{self.category} - {self.question}"


class ChatbotLearningData(models.Model):
    SOURCE_CHOICES = [
        ("patient", "Patient"),
        ("pharmacy", "Pharmacy"),
        ("admin", "Admin"),
        ("system", "System"),
    ]

    original_text = models.TextField()
    detected_intent = models.CharField(max_length=120, blank=True)
    original_gemini_text = models.TextField(blank=True)
    detected_medicine = models.CharField(max_length=255, blank=True)
    corrected_medicine = models.CharField(max_length=255, blank=True)
    detected_dosage = models.CharField(max_length=100, blank=True)
    corrected_dosage = models.CharField(max_length=100, blank=True)
    detected_form = models.CharField(max_length=100, blank=True)
    corrected_form = models.CharField(max_length=100, blank=True)
    detected_posology = models.TextField(blank=True)
    corrected_posology = models.TextField(blank=True)
    corrected_answer = models.TextField(blank=True)
    source = models.CharField(max_length=20, choices=SOURCE_CHOICES, default="system")
    confidence_before = models.FloatField(default=0.0)
    confidence_after = models.FloatField(default=0.0)
    prescription = models.ForeignKey(
        "prescriptions.Prescription",
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="chatbot_learning_events",
    )
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="chatbot_learning_events",
    )
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-created_at"]

    def __str__(self):
        return f"{self.source} - {self.detected_intent or 'unknown'}"


class ConversationSession(models.Model):
    SESSION_STATUS_CHOICES = [
        ("open", "Open"),
        ("closed", "Closed"),
    ]

    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        null=True,
        blank=True,
        on_delete=models.CASCADE,
        related_name="chatbot_sessions",
    )
    pharmacy = models.ForeignKey(
        RealPharmacy,
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="chatbot_sessions",
    )
    prescription = models.ForeignKey(
        RealPrescription,
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="chatbot_sessions",
    )
    session_key = models.CharField(max_length=120, db_index=True)
    status = models.CharField(max_length=16, choices=SESSION_STATUS_CHOICES, default="open")
    context_snapshot = models.JSONField(default=dict, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["-updated_at"]

    def __str__(self):
        return f"{self.session_key} ({self.status})"


class ConversationHistory(models.Model):
    SENDER_CHOICES = [
        ("user", "User"),
        ("bot", "Bot"),
        ("system", "System"),
    ]

    session = models.ForeignKey(
        ConversationSession,
        on_delete=models.CASCADE,
        related_name="messages",
    )
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="chatbot_conversation_messages",
    )
    prescription = models.ForeignKey(
        RealPrescription,
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="chatbot_conversation_messages",
    )
    sender = models.CharField(max_length=20, choices=SENDER_CHOICES)
    message = models.TextField()
    metadata = models.JSONField(default=dict, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["created_at"]

    def __str__(self):
        return f"{self.sender}: {self.message[:40]}"


class RetrievalStoreConfig(models.Model):
    PROVIDER_CHOICES = [
        ("faiss", "FAISS"),
        ("pinecone", "Pinecone"),
        ("none", "None"),
    ]

    provider = models.CharField(max_length=20, choices=PROVIDER_CHOICES, default="faiss")
    index_name = models.CharField(max_length=120, blank=True)
    embedding_model = models.CharField(max_length=120, blank=True, default="text-embedding-3-small")
    is_enabled = models.BooleanField(default=False)
    settings_json = models.JSONField(default=dict, blank=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        verbose_name = "Retrieval store configuration"
        verbose_name_plural = "Retrieval store configurations"

    def __str__(self):
        return f"{self.provider}:{self.index_name or 'default'}"


class RetrievalDocument(models.Model):
    SOURCE_CHOICES = [
        ("stock", "Stock"),
        ("prescription", "Prescription"),
        ("pharmacy", "Pharmacy"),
        ("knowledge", "Knowledge"),
    ]

    source_type = models.CharField(max_length=20, choices=SOURCE_CHOICES)
    source_id = models.PositiveIntegerField(db_index=True)
    title = models.CharField(max_length=255)
    content = models.TextField()
    metadata = models.JSONField(default=dict, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["-updated_at"]

    def __str__(self):
        return f"{self.source_type}:{self.source_id} {self.title}"
