from django.urls import reverse
from rest_framework import serializers

from .models import ChatMessage


class ChatMessageSerializer(serializers.ModelSerializer):
    pharmacy_name = serializers.CharField(source="pharmacy.name", read_only=True)
    sender_pharmacy_name = serializers.CharField(source="sender_pharmacy.name", read_only=True)
    recipient_user_name = serializers.CharField(source="recipient_user.username", read_only=True)
    sender_user_name = serializers.CharField(source="sender_user.username", read_only=True)
    recipient_user_profile_image = serializers.SerializerMethodField()
    sender_user_profile_image = serializers.SerializerMethodField()

    def get_recipient_user_profile_image(self, obj):
        recipient = getattr(obj, "recipient_user", None)
        profile = getattr(recipient, "profile", None)
        if recipient is None or profile is None or not getattr(profile, "profile_image", None):
            return None
        try:
            return reverse("user-profile-image", kwargs={"pk": recipient.pk})
        except Exception:
            return None

    def get_sender_user_profile_image(self, obj):
        sender = getattr(obj, "sender_user", None)
        profile = getattr(sender, "profile", None)
        if sender is None or profile is None or not getattr(profile, "profile_image", None):
            return None
        try:
            return reverse("user-profile-image", kwargs={"pk": sender.pk})
        except Exception:
            return None

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
