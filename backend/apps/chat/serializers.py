from rest_framework import serializers

from .models import ChatMessage


class ChatMessageSerializer(serializers.ModelSerializer):
    pharmacy_name = serializers.CharField(source="pharmacy.name", read_only=True)
    sender_pharmacy_name = serializers.CharField(source="sender_pharmacy.name", read_only=True)

    class Meta:
        model = ChatMessage
        fields = [
            "id",
            "pharmacy",
            "pharmacy_name",
            "sender_pharmacy",
            "sender_pharmacy_name",
            "sender_name",
            "sender_role",
            "message",
            "created_at",
        ]
