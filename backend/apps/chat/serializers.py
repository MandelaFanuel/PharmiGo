from rest_framework import serializers

from .models import ChatMessage


class ChatMessageSerializer(serializers.ModelSerializer):
    pharmacy_name = serializers.CharField(source="pharmacy.name", read_only=True)
    sender_pharmacy_name = serializers.CharField(source="sender_pharmacy.name", read_only=True)
    recipient_user_name = serializers.CharField(source="recipient_user.username", read_only=True)
    sender_user_name = serializers.CharField(source="sender_user.username", read_only=True)
    recipient_user_profile_image = serializers.ImageField(source="recipient_user.profile.profile_image", read_only=True)
    sender_user_profile_image = serializers.ImageField(source="sender_user.profile.profile_image", read_only=True)

    class Meta:
        model = ChatMessage
        fields = [
            "id",
            "pharmacy",
            "pharmacy_name",
            "sender_pharmacy",
            "sender_pharmacy_name",
            "recipient_user",
            "recipient_user_name",
            "recipient_user_profile_image",
            "sender_user",
            "sender_user_name",
            "sender_user_profile_image",
            "sender_name",
            "sender_role",
            "message",
            "created_at",
        ]
