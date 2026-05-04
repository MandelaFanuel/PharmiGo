from rest_framework import serializers
from django.contrib.auth import get_user_model
from django.urls import reverse

from .models import (
    Prescription,
    PrescriptionComment,
    PrescriptionEngagement,
    PrescriptionResponse,
    PharmacyStock,
    MedicationExtraction,
)

User = get_user_model()


class PrescriptionResponseSerializer(serializers.ModelSerializer):
    pharmacy_name = serializers.CharField(source="pharmacy.name", read_only=True)

    class Meta:
        model = PrescriptionResponse
        fields = [
            "id",
            "prescription",
            "pharmacy",
            "pharmacy_name",
            "responder_name",
            "availability_note",
            "estimated_minutes",
            "total_price",
            "status",
            "created_at",
        ]


class PrescriptionCommentSerializer(serializers.ModelSerializer):
    author_name = serializers.SerializerMethodField()
    author_role = serializers.SerializerMethodField()

    class Meta:
        model = PrescriptionComment
        fields = [
            "id",
            "author_name",
            "author_role",
            "body",
            "created_at",
        ]

    def get_author_name(self, obj):
        profile = getattr(obj.user, "profile", None)
        if profile is not None and profile.role == "pharmacy" and profile.pharmacy is not None:
            return profile.pharmacy.name
        return obj.user.username

    def get_author_role(self, obj):
        profile = getattr(obj.user, "profile", None)
        if profile is not None:
            return profile.role
        return "patient"


class PrescriptionSerializer(serializers.ModelSerializer):
    public_reference = serializers.SerializerMethodField()
    patient_name = serializers.SerializerMethodField()
    patient_email = serializers.SerializerMethodField()
    pharmacy_name = serializers.SerializerMethodField()
    response_count = serializers.IntegerField(source="responses.count", read_only=True)
    comment_count = serializers.IntegerField(source="comments.count", read_only=True)
    patient_user = serializers.IntegerField(source="patient_user_id", read_only=True)
    like_count = serializers.SerializerMethodField()
    share_count = serializers.SerializerMethodField()
    viewer_has_liked = serializers.SerializerMethodField()
    viewer_has_shared = serializers.SerializerMethodField()
    bot_result = serializers.JSONField(read_only=True)
    comments = PrescriptionCommentSerializer(many=True, read_only=True)
    responses = PrescriptionResponseSerializer(many=True, read_only=True)
    extracted_medications = serializers.SerializerMethodField()
    prescription_file = serializers.SerializerMethodField()
    prescription_image = serializers.SerializerMethodField()
    geo_zone = serializers.CharField(read_only=True)
    document_access_url = serializers.SerializerMethodField()
    document_access_granted = serializers.SerializerMethodField()
    confidence_score = serializers.SerializerMethodField()

    class Meta:
        model = Prescription
        fields = [
            "id",
            "public_reference",
            "geo_zone",
            "patient_name",
            "patient_email",
            "patient_user",
            "medication_name",
            "dosage",
            "instructions",
            "pharmacy",
            "pharmacy_name",
            "prescription_file",
            "prescription_image",
            "document_access_url",
            "document_access_granted",
            "status",
            "response_count",
            "comment_count",
            "like_count",
            "share_count",
            "viewer_has_liked",
            "viewer_has_shared",
            "created_at",
            "ocr_text",
            "confidence_score",
            "bot_result",
            "comments",
            "responses",
            "extracted_medications",
        ]

    def _get_request_user(self):
        request = self.context.get("request")
        if request is None:
            return None

        authenticated_user = getattr(request, "user", None)
        if authenticated_user is not None and getattr(authenticated_user, "is_authenticated", False):
            return authenticated_user
        return None

    def get_like_count(self, obj):
        return obj.engagements.filter(liked=True).count()

    def get_share_count(self, obj):
        return obj.engagements.filter(shared_at__isnull=False).count()

    def get_viewer_has_liked(self, obj):
        user = self._get_request_user()
        if user is None:
            return False
        return PrescriptionEngagement.objects.filter(prescription=obj, user=user, liked=True).exists()

    def get_viewer_has_shared(self, obj):
        user = self._get_request_user()
        if user is None:
            return False
        return PrescriptionEngagement.objects.filter(prescription=obj, user=user, shared_at__isnull=False).exists()

    def _is_admin(self, user):
        return bool(user and getattr(user, "is_staff", False))

    def _is_owner(self, obj, user):
        return bool(user and obj.patient_user_id and user.id == obj.patient_user_id)

    def _is_selected_pharmacy(self, obj, user):
        profile = getattr(user, "profile", None)
        return bool(profile and profile.role == "pharmacy" and profile.pharmacy_id and profile.pharmacy_id == obj.pharmacy_id)

    def _can_view_sensitive_details(self, obj):
        user = self._get_request_user()
        return self._is_admin(user) or self._is_owner(obj, user) or self._is_selected_pharmacy(obj, user)

    def get_patient_name(self, obj):
        if self._can_view_sensitive_details(obj):
            return obj.patient_name
        return obj.get_public_patient_alias()

    def get_patient_email(self, obj):
        if self._can_view_sensitive_details(obj):
            return obj.patient_email
        return ""

    def get_public_reference(self, obj):
        if obj.public_reference:
            return obj.public_reference
        return f"ORD-{obj.id:06d}"

    def get_pharmacy_name(self, obj):
        if obj.pharmacy_id and getattr(obj.pharmacy, "name", ""):
            return obj.pharmacy.name

        latest_response = obj.responses.order_by("-created_at").select_related("pharmacy").first()
        if latest_response and latest_response.pharmacy and latest_response.pharmacy.name:
            return latest_response.pharmacy.name

        return ""

    def get_extracted_medications(self, obj):
        queryset = obj.extracted_medications.all().order_by("-confidence", "id")
        if not self._can_view_sensitive_details(obj):
            queryset = queryset.filter(confirmed=True)

        return [
            {
                "id": medication.id,
                "name": medication.name,
                "generic_name": medication.generic_name,
                "dosage": medication.dosage,
                "form": medication.form,
                "quantity": medication.quantity,
                "unit": medication.unit,
                "posology": medication.posology,
                "confidence": medication.confidence,
                "confirmed": medication.confirmed,
                "alternatives": medication.alternatives,
                "requires_prescription": medication.requires_prescription,
            }
            for medication in queryset
        ]

    def _build_secure_document_url(self, obj):
        request = self.context.get("request")
        if request is None or not self._can_view_sensitive_details(obj) or not obj.has_private_document():
            return None
        return reverse("prescription-document-access", kwargs={"prescription_id": obj.id})

    def get_prescription_file(self, obj):
        return self._build_secure_document_url(obj)

    def get_prescription_image(self, obj):
        return self._build_secure_document_url(obj)

    def get_document_access_url(self, obj):
        return self._build_secure_document_url(obj)

    def get_document_access_granted(self, obj):
        return bool(self._build_secure_document_url(obj))

    def get_confidence_score(self, obj):
        raw_value = getattr(obj, "confidence_score", 0.0)
        try:
            return float(raw_value or 0.0)
        except (TypeError, ValueError):
            return 0.0

    def to_representation(self, instance):
        data = super().to_representation(instance)
        if self._can_view_sensitive_details(instance):
            return data

        data["patient_user"] = None
        data["instructions"] = ""
        data["ocr_text"] = ""
        data["confidence_score"] = 0.0
        data["bot_result"] = None
        data["comments"] = []
        data["responses"] = []
        return data


class PharmacyStockSerializer(serializers.ModelSerializer):
    """Serializer for pharmacy stock management"""
    pharmacy_name = serializers.CharField(source="pharmacy.name", read_only=True)

    class Meta:
        model = PharmacyStock
        fields = [
            "id",
            "pharmacy",
            "pharmacy_name",
            "medication_name",
            "generic_name",
            "dosage",
            "quantity",
            "unit",
            "price",
            "last_updated",
            "is_available",
        ]
        read_only_fields = ["pharmacy", "last_updated"]

    def validate_quantity(self, value):
        if value < 0:
            raise serializers.ValidationError("La quantité ne peut pas être négative.")
        return value

    def validate_price(self, value):
        if value < 0:
            raise serializers.ValidationError("Le prix ne peut pas être négatif.")
        return value
