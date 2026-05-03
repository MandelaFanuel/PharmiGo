from rest_framework import serializers
from .models import (
    Pharmacy,
    Medicine,
    MedicineSynonym,
    PharmacyStock,
    Prescription,
    PrescriptionItem,
    ChatbotKnowledgeBase,
    ChatbotLearningData,
    ConversationSession,
    ConversationHistory,
    RetrievalStoreConfig,
    RetrievalDocument,
)


class PharmacySerializer(serializers.ModelSerializer):
    class Meta:
        model = Pharmacy
        fields = "__all__"


class MedicineSynonymSerializer(serializers.ModelSerializer):
    class Meta:
        model = MedicineSynonym
        fields = "__all__"


class MedicineSerializer(serializers.ModelSerializer):
    synonyms = MedicineSynonymSerializer(many=True, read_only=True)

    class Meta:
        model = Medicine
        fields = "__all__"


class PharmacyStockSerializer(serializers.ModelSerializer):
    class Meta:
        model = PharmacyStock
        fields = "__all__"


class PrescriptionItemSerializer(serializers.ModelSerializer):
    class Meta:
        model = PrescriptionItem
        fields = "__all__"


class PrescriptionSerializer(serializers.ModelSerializer):
    items = PrescriptionItemSerializer(many=True, read_only=True)

    class Meta:
        model = Prescription
        fields = "__all__"
        read_only_fields = [
            "patient",
            "status",
            "selected_pharmacy",
            "extracted_text",
            "confidence_score",
            "selected_at",
            "pharmacy_confirmed_at",
            "patient_confirmed_at",
            "served_at",
        ]


class ChatbotKnowledgeBaseSerializer(serializers.ModelSerializer):
    class Meta:
        model = ChatbotKnowledgeBase
        fields = "__all__"


class ChatbotLearningDataSerializer(serializers.ModelSerializer):
    class Meta:
        model = ChatbotLearningData
        fields = "__all__"


class ConversationSessionSerializer(serializers.ModelSerializer):
    class Meta:
        model = ConversationSession
        fields = "__all__"


class ConversationHistorySerializer(serializers.ModelSerializer):
    class Meta:
        model = ConversationHistory
        fields = ["id", "session", "sender", "message", "metadata", "created_at", "prescription", "user"]
        read_only_fields = ["id", "created_at"]


class RetrievalStoreConfigSerializer(serializers.ModelSerializer):
    class Meta:
        model = RetrievalStoreConfig
        fields = "__all__"


class RetrievalDocumentSerializer(serializers.ModelSerializer):
    class Meta:
        model = RetrievalDocument
        fields = "__all__"
