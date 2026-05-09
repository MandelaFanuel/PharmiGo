from django.contrib.auth import get_user_model
from django.db.models import Avg
from django.urls import reverse
from rest_framework import serializers

from .models import Pharmacy, PharmacyComment, PharmacyEngagement, PharmacyContact, PharmacySubscription, SubscriptionPayment, SubscriptionSystemSettings
from .payment_config import sanitize_payment_methods
from .services.access import is_pharmacy_partner_eligible

User = get_user_model()


class PharmacyContactSerializer(serializers.ModelSerializer):
    """Serializer for pharmacy contacts."""
    pharmacy_name = serializers.CharField(source="pharmacy.name", read_only=True)
    contact_pharmacy_name = serializers.CharField(source="contact_pharmacy.name", read_only=True)

    class Meta:
        model = PharmacyContact
        fields = ["id", "pharmacy", "pharmacy_name", "contact_pharmacy", "contact_pharmacy_name", "created_at"]
        read_only_fields = ["pharmacy", "created_at"]


class PharmacyCommentSerializer(serializers.ModelSerializer):
    author_name = serializers.SerializerMethodField()
    author_role = serializers.SerializerMethodField()

    class Meta:
        model = PharmacyComment
        fields = ["id", "author_name", "author_role", "body", "created_at"]

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


class PharmacySerializer(serializers.ModelSerializer):
    prescription_count = serializers.IntegerField(read_only=True)
    response_count = serializers.IntegerField(read_only=True)
    is_open = serializers.SerializerMethodField()
    delivery_available = serializers.BooleanField(source="delivery_supported", read_only=True)
    profile_image = serializers.SerializerMethodField()
    comments = PharmacyCommentSerializer(many=True, read_only=True)
    comment_count = serializers.IntegerField(source="comments.count", read_only=True)
    like_count = serializers.SerializerMethodField()
    share_count = serializers.SerializerMethodField()
    viewer_has_liked = serializers.SerializerMethodField()
    viewer_has_shared = serializers.SerializerMethodField()
    is_online = serializers.SerializerMethodField()
    last_seen = serializers.SerializerMethodField()
    response_time_minutes = serializers.SerializerMethodField()
    subscription_status = serializers.SerializerMethodField()
    is_official = serializers.SerializerMethodField()
    trial_days_remaining = serializers.SerializerMethodField()

    def get_is_open(self, obj):
        return True

    def get_profile_image(self, obj):
        if not obj.profile_image:
            return None

        try:
            image_path = reverse("pharmacy-profile-image", kwargs={"pk": obj.pk})
            request = self.context.get("request")
            if request is not None:
                return request.build_absolute_uri(image_path)
            return image_path
        except Exception:
            return None

    def get_is_online(self, obj):
        linked_profile = getattr(obj, "user_profile", None)
        if linked_profile is None:
            return False
        return linked_profile.is_considered_online()

    def get_last_seen(self, obj):
        linked_profile = getattr(obj, "user_profile", None)
        return getattr(linked_profile, "last_seen", None)

    def get_response_time_minutes(self, obj):
        average = obj.responses.aggregate(value=Avg("estimated_minutes")).get("value")
        return round(float(average), 1) if average is not None else 0

    def get_subscription_status(self, obj):
        subscription = getattr(obj, "subscription", None)
        return getattr(subscription, "subscription_status", None)

    def get_is_official(self, obj):
        return is_pharmacy_partner_eligible(obj)

    def get_trial_days_remaining(self, obj):
        subscription = getattr(obj, "subscription", None)
        if subscription is None:
            return None
        if subscription.subscription_status != "trial" or not subscription.is_trial_active or not subscription.trial_end_date:
            return None
        from django.utils import timezone

        delta = subscription.trial_end_date - timezone.now()
        return max(0, delta.days)

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
        return PharmacyEngagement.objects.filter(pharmacy=obj, user=user, liked=True).exists()

    def get_viewer_has_shared(self, obj):
        user = self._get_request_user()
        if user is None:
            return False
        return PharmacyEngagement.objects.filter(pharmacy=obj, user=user, shared_at__isnull=False).exists()

    class Meta:
        model = Pharmacy
        fields = "__all__"


class PharmacySubscriptionSerializer(serializers.ModelSerializer):
    days_remaining = serializers.SerializerMethodField()
    
    class Meta:
        model = PharmacySubscription
        fields = [
            "id",
            "pharmacy",
            "trial_start_date",
            "trial_end_date",
            "is_trial_active",
            "subscription_status",
            "monthly_price_usd",
            "current_exchange_rate_bif",
            "monthly_price_bif",
            "last_payment_date",
            "next_payment_due_date",
            "days_remaining",
            "created_at",
            "updated_at",
        ]
        read_only_fields = ["created_at", "updated_at"]
    
    def get_days_remaining(self, obj):
        """Calculate days remaining in trial or until next payment"""
        from django.utils import timezone
        
        if obj.subscription_status == "trial" and obj.is_trial_active:
            if obj.trial_end_date:
                delta = obj.trial_end_date - timezone.now()
                return max(0, delta.days)
        elif obj.next_payment_due_date:
            delta = obj.next_payment_due_date - timezone.now()
            return max(0, delta.days)
        return 0


class SubscriptionPaymentSerializer(serializers.ModelSerializer):
    pharmacy_name = serializers.CharField(source="pharmacy.name", read_only=True)
    payment_method = serializers.CharField(max_length=20)
    
    class Meta:
        model = SubscriptionPayment
        fields = [
            "id",
            "pharmacy",
            "pharmacy_name",
            "amount_usd",
            "amount_bif",
            "currency",
            "payment_method",
            "payer_name",
            "payer_address",
            "sender_phone",
            "receiver_phone",
            "transaction_reference",
            "payment_status",
            "proof_image",
            "payment_month",
            "created_at",
            "verified_at",
            "verified_by",
        ]
        read_only_fields = ["pharmacy", "pharmacy_name", "created_at", "verified_at", "verified_by"]


class SubscriptionSystemSettingsSerializer(serializers.ModelSerializer):
    payment_methods = serializers.ListField(child=serializers.DictField(), required=False)

    def validate_payment_methods(self, value):
        return sanitize_payment_methods(value)

    class Meta:
        model = SubscriptionSystemSettings
        fields = ["trial_period_days", "monthly_price_usd", "payment_methods", "updated_by", "updated_at"]
        read_only_fields = ["updated_by", "updated_at"]
