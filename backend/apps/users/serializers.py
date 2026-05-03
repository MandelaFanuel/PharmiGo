import os
from django.contrib.auth import authenticate, get_user_model
from django.contrib.auth.tokens import default_token_generator
from datetime import timedelta
from django.db import transaction
from django.utils.encoding import force_bytes
from django.utils.http import urlsafe_base64_encode
from django.utils import timezone
from rest_framework import serializers

from apps.pharmacies.models import Pharmacy, PharmacySubscription, SubscriptionSystemSettings
from apps.users.models import UserProfile
from apps.users.phone_numbers import UNSUPPORTED_PHONE_MESSAGE, normalize_phone_number

User = get_user_model()

DEFAULT_ADMIN_EMAIL = os.getenv("DEFAULT_ADMIN_EMAIL", "admin@pharmigo.com").strip().lower()
DEFAULT_ADMIN_PASSWORD = os.getenv("DEFAULT_ADMIN_PASSWORD", "").strip()
DEFAULT_ADMIN_USERNAME = os.getenv("DEFAULT_ADMIN_USERNAME", "admin").strip() or "admin"


def ensure_default_admin_user():
    if not DEFAULT_ADMIN_PASSWORD:
        return None

    user, created = User.objects.get_or_create(
        username=DEFAULT_ADMIN_USERNAME,
        defaults={
            "email": DEFAULT_ADMIN_EMAIL,
            "is_staff": True,
            "is_superuser": True,
        },
    )

    should_save = created
    if user.email != DEFAULT_ADMIN_EMAIL:
        user.email = DEFAULT_ADMIN_EMAIL
        should_save = True
    if not user.is_staff:
        user.is_staff = True
        should_save = True
    if not user.is_superuser:
        user.is_superuser = True
        should_save = True
    if not user.check_password(DEFAULT_ADMIN_PASSWORD):
        user.set_password(DEFAULT_ADMIN_PASSWORD)
        should_save = True

    if should_save:
        user.save()

    UserProfile.objects.get_or_create(
        user=user,
        defaults={
            "role": "admin",
            "phone_number": "",
            "whatsapp_number": "",
            "address": "",
        },
    )

    return user


def infer_city(address: str) -> str:
    parts = [part.strip() for part in address.split(",") if part.strip()]
    if not parts:
        return "Ville non renseignee"
    return parts[-1][:120]


def email_already_used(email: str, *, exclude_user_id: int | None = None, exclude_pharmacy_id: int | None = None) -> bool:
    normalized = email.strip().lower()
    if not normalized:
        return False

    user_queryset = User.objects.exclude(pk=exclude_user_id) if exclude_user_id else User.objects.all()
    if user_queryset.filter(email__iexact=normalized).exists():
        return True

    pharmacy_queryset = Pharmacy.objects.exclude(pk=exclude_pharmacy_id) if exclude_pharmacy_id else Pharmacy.objects.all()
    return pharmacy_queryset.filter(email__iexact=normalized).exists()


class UserProfileSerializer(serializers.ModelSerializer):
    profile_image = serializers.ImageField(read_only=True)
    pharmacy_name = serializers.CharField(source="pharmacy.name", read_only=True)
    pharmacy_image = serializers.ImageField(source="pharmacy.profile_image", read_only=True)
    pharmacy_created_at = serializers.DateTimeField(source="pharmacy.created_at", read_only=True)
    is_online = serializers.SerializerMethodField()
    pharmacy_is_online = serializers.SerializerMethodField()
    pharmacy_city = serializers.CharField(source="pharmacy.city", read_only=True)
    pharmacy_email = serializers.EmailField(source="pharmacy.email", read_only=True)
    pharmacy_opening_hours = serializers.CharField(source="pharmacy.opening_hours", read_only=True)
    pharmacy_delivery_supported = serializers.BooleanField(source="pharmacy.delivery_supported", read_only=True)
    pharmacy_phone_number = serializers.CharField(source="pharmacy.phone_number", read_only=True)

    def get_is_online(self, obj):
        return obj.is_considered_online()

    def get_pharmacy_is_online(self, obj):
        pharmacy_profile = getattr(getattr(obj, "pharmacy", None), "user_profile", None)
        if pharmacy_profile is None:
            return False
        return pharmacy_profile.is_considered_online()

    class Meta:
        model = UserProfile
        fields = [
            "role",
            "phone_number",
            "whatsapp_number",
            "address",
            "latitude",
            "longitude",
            "location_city",
            "location_country",
            "created_at",
            "profile_image",
            "is_online",
            "last_seen",
            "pharmacy",
            "pharmacy_name",
            "pharmacy_image",
            "pharmacy_created_at",
            "pharmacy_is_online",
            "pharmacy_city",
            "pharmacy_email",
            "pharmacy_opening_hours",
            "pharmacy_delivery_supported",
            "pharmacy_phone_number",
        ]


class UserSerializer(serializers.ModelSerializer):
    profile = UserProfileSerializer(read_only=True)

    class Meta:
        model = User
        fields = ["id", "username", "email", "first_name", "last_name", "is_staff", "is_active", "profile"]


class RegisterSerializer(serializers.Serializer):
    account_type = serializers.ChoiceField(choices=["patient", "pharmacy"])
    username = serializers.CharField(required=False, allow_blank=True, max_length=150)
    phone_number = serializers.CharField(required=False, allow_blank=True, max_length=30)
    email = serializers.EmailField(required=False, allow_blank=True)
    password = serializers.CharField(write_only=True, min_length=6, max_length=128)
    pharmacy_name = serializers.CharField(required=False, allow_blank=True, max_length=255)
    address = serializers.CharField(required=False, allow_blank=True, max_length=255)
    pharmacy_image = serializers.ImageField(required=False, allow_null=True)

    def validate(self, attrs):
        account_type = attrs["account_type"]
        phone_number = normalize_phone_number(attrs.get("phone_number", ""))
        email = str(attrs.get("email", "")).strip().lower()
        attrs["phone_number"] = phone_number
        attrs["email"] = email

        if email and email_already_used(email):
            raise serializers.ValidationError({"email": "Cette adresse email est deja utilisee."})

        if account_type == "patient":
            if not attrs.get("username", "").strip():
                raise serializers.ValidationError({"username": "Le nom d'utilisateur est obligatoire."})
            if User.objects.filter(username=attrs["username"].strip()).exists():
                raise serializers.ValidationError({"username": "Ce nom d'utilisateur est deja utilise."})
            if UserProfile.objects.filter(phone_number=phone_number).exists():
                raise serializers.ValidationError({"phone_number": "Ce numero de telephone est deja utilise."})
        else:
            if not attrs.get("pharmacy_name", "").strip():
                raise serializers.ValidationError({"pharmacy_name": "Le nom de la pharmacie est obligatoire."})
            if not attrs.get("address", "").strip():
                raise serializers.ValidationError({"address": "L'adresse exacte est obligatoire."})
            if UserProfile.objects.filter(phone_number=phone_number).exists():
                raise serializers.ValidationError({"phone_number": "Ce numero de telephone est deja utilise."})

        return attrs

    @transaction.atomic
    def create(self, validated_data):
        account_type = validated_data["account_type"]
        password = validated_data["password"]

        if account_type == "patient":
            username = validated_data["username"].strip()
            user = User.objects.create_user(username=username, email=validated_data["email"], password=password)
            UserProfile.objects.create(
                user=user,
                role="patient",
                phone_number=validated_data["phone_number"],
            )
            return user

        pharmacy_name = validated_data["pharmacy_name"].strip()
        phone_number = validated_data["phone_number"]
        address = validated_data["address"].strip()
        generated_username = f"{pharmacy_name.lower().replace(' ', '-')[:18]}-{phone_number[-4:]}"
        suffix = 1
        unique_username = generated_username
        while User.objects.filter(username=unique_username).exists():
            suffix += 1
            unique_username = f"{generated_username[:20]}-{suffix}"

        pharmacy = Pharmacy.objects.create(
            name=pharmacy_name,
            profile_image=validated_data.get("pharmacy_image"),
            city=infer_city(address),
            address=address,
            phone_number=phone_number,
            email=validated_data["email"],
            opening_hours="08:00 - 20:00",
            delivery_supported=False,
        )
        user = User.objects.create_user(username=unique_username, email=validated_data["email"], password=password)
        UserProfile.objects.create(
            user=user,
            role="pharmacy",
            phone_number=phone_number,
            whatsapp_number=phone_number,
            address=address,
            pharmacy=pharmacy,
        )
        subscription_settings = SubscriptionSystemSettings.get_solo()
        PharmacySubscription.objects.get_or_create(
            pharmacy=pharmacy,
            defaults={
                "trial_start_date": timezone.now(),
                "trial_end_date": timezone.now() + timedelta(days=subscription_settings.trial_period_days),
                "is_trial_active": True,
                "subscription_status": "trial",
                "monthly_price_usd": subscription_settings.monthly_price_usd,
            },
        )
        return user


class LoginSerializer(serializers.Serializer):
    phone_number = serializers.CharField(max_length=30)
    password = serializers.CharField(write_only=True, max_length=128)

    def _resolve_profile(self, raw_phone_number: str):
        try:
            phone_number = normalize_phone_number(raw_phone_number)
        except serializers.ValidationError:
            raise serializers.ValidationError({"phone_number": UNSUPPORTED_PHONE_MESSAGE})

        if phone_number:
            profile = UserProfile.objects.filter(phone_number=phone_number).select_related("user").first()
            if profile is None:
                profile = UserProfile.objects.filter(whatsapp_number=phone_number).select_related("user").first()
            if profile is not None:
                return profile

        raise serializers.ValidationError({"phone_number": "Numero ou mot de passe invalide."})

    def validate(self, attrs):
        password = attrs["password"]
        identifier = str(attrs["phone_number"]).strip()

        if not identifier:
            raise serializers.ValidationError({"phone_number": "Le numero de telephone est obligatoire."})

        if "@" in identifier:
            if identifier.lower() != DEFAULT_ADMIN_EMAIL:
                raise serializers.ValidationError(
                    {
                        "phone_number": "Adresse email non autorisee. Seul l'administrateur peut se connecter par email."
                    }
                )

            admin_user = ensure_default_admin_user()
            if admin_user is None:
                raise serializers.ValidationError({"phone_number": "Connexion administrateur indisponible."})
            user = authenticate(username=admin_user.username, password=password)
            if user is None:
                raise serializers.ValidationError({"phone_number": "Email administrateur ou mot de passe invalide."})
            attrs["user"] = user
            return attrs

        if identifier.lower() == DEFAULT_ADMIN_USERNAME:
            raise serializers.ValidationError(
                {"phone_number": "L'administrateur doit se connecter avec son adresse email officielle."}
            )

        if identifier.lower() == DEFAULT_ADMIN_EMAIL:
            admin_user = ensure_default_admin_user()
            if admin_user is None:
                raise serializers.ValidationError({"phone_number": "Connexion administrateur indisponible."})
            user = authenticate(username=admin_user.username, password=password)
            if user is None:
                raise serializers.ValidationError({"phone_number": "Email administrateur ou mot de passe invalide."})
            attrs["user"] = user
            return attrs

        profile = self._resolve_profile(identifier)

        user = None
        if profile is not None:
            user = authenticate(username=profile.user.username, password=password)

        if user is None:
            raise serializers.ValidationError({"phone_number": "Numero de telephone ou mot de passe invalide."})

        attrs["user"] = user
        return attrs


class PasswordResetRequestSerializer(serializers.Serializer):
    email = serializers.EmailField()


class PasswordResetConfirmSerializer(serializers.Serializer):
    uid = serializers.CharField()
    token = serializers.CharField()
    new_password = serializers.CharField(write_only=True, min_length=6, max_length=128)


def build_password_reset_payload(user):
    uid = urlsafe_base64_encode(force_bytes(user.pk))
    token = default_token_generator.make_token(user)
    return {"uid": uid, "token": token}
