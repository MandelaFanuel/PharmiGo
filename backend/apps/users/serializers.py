import os
from django.contrib.auth import authenticate, get_user_model
from django.contrib.auth.tokens import default_token_generator
from datetime import timedelta
from django.db import transaction
from django.urls import reverse
from django.utils.encoding import force_bytes
from django.utils.http import urlsafe_base64_encode
from django.utils import timezone
from rest_framework import serializers

from apps.pharmacies.models import Pharmacy, PharmacySubscription, SubscriptionSystemSettings
from apps.users.models import UserProfile
from apps.users.phone_numbers import normalize_phone_number
from apps.users.services import build_unique_username, verify_google_credential

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
            "email_verified": True,
        },
    )

    profile = user.profile
    if not profile.email_verified:
        profile.email_verified = True
        profile.save(update_fields=["email_verified"])

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


def phone_number_already_used(phone_number: str, *, exclude_profile_id: int | None = None, exclude_pharmacy_id: int | None = None) -> bool:
    normalized = normalize_phone_number(phone_number)
    if not normalized:
        return False

    profile_queryset = UserProfile.objects.exclude(pk=exclude_profile_id) if exclude_profile_id else UserProfile.objects.all()
    if profile_queryset.filter(phone_number=normalized).exists():
        return True

    pharmacy_queryset = Pharmacy.objects.exclude(pk=exclude_pharmacy_id) if exclude_pharmacy_id else Pharmacy.objects.all()
    return pharmacy_queryset.filter(phone_number=normalized).exists()


class UserProfileSerializer(serializers.ModelSerializer):
    profile_image = serializers.ImageField(read_only=True)
    pharmacy_name = serializers.CharField(source="pharmacy.name", read_only=True)
    pharmacy_image = serializers.SerializerMethodField()
    pharmacy_created_at = serializers.DateTimeField(source="pharmacy.created_at", read_only=True)
    is_online = serializers.SerializerMethodField()
    pharmacy_is_online = serializers.SerializerMethodField()
    pharmacy_city = serializers.CharField(source="pharmacy.city", read_only=True)
    pharmacy_email = serializers.EmailField(source="pharmacy.email", read_only=True)
    pharmacy_opening_hours = serializers.CharField(source="pharmacy.opening_hours", read_only=True)
    pharmacy_delivery_supported = serializers.BooleanField(source="pharmacy.delivery_supported", read_only=True)
    pharmacy_phone_number = serializers.CharField(source="pharmacy.phone_number", read_only=True)
    google_connected = serializers.SerializerMethodField()

    def get_is_online(self, obj):
        return obj.is_considered_online()

    def get_pharmacy_is_online(self, obj):
        pharmacy_profile = getattr(getattr(obj, "pharmacy", None), "user_profile", None)
        if pharmacy_profile is None:
            return False
        return pharmacy_profile.is_considered_online()

    def get_google_connected(self, obj):
        return bool(obj.google_sub)

    def get_pharmacy_image(self, obj):
        pharmacy = getattr(obj, "pharmacy", None)
        if pharmacy is None or not getattr(pharmacy, "profile_image", None):
            return None

        image_path = reverse("pharmacy-profile-image", kwargs={"pk": pharmacy.pk})
        request = self.context.get("request")
        if request is not None:
            return request.build_absolute_uri(image_path)
        return image_path

    class Meta:
        model = UserProfile
        fields = [
            "role",
            "phone_number",
            "whatsapp_number",
            "birth_date",
            "gender",
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
            "email_verified",
            "google_connected",
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
    birth_date = serializers.DateField(required=False, allow_null=True)
    gender = serializers.ChoiceField(choices=["male", "female", "other"], required=False, allow_blank=True)
    email = serializers.EmailField(required=True, allow_blank=False)
    password = serializers.CharField(write_only=True, min_length=6, max_length=128)
    pharmacy_name = serializers.CharField(required=False, allow_blank=True, max_length=255)
    address = serializers.CharField(required=False, allow_blank=True, max_length=255)
    pharmacy_image = serializers.ImageField(required=False, allow_null=True)
    latitude = serializers.FloatField(required=False, allow_null=True)
    longitude = serializers.FloatField(required=False, allow_null=True)
    location_city = serializers.CharField(required=False, allow_blank=True, max_length=120)
    location_country = serializers.CharField(required=False, allow_blank=True, max_length=120)

    def validate(self, attrs):
        account_type = attrs["account_type"]
        phone_number = normalize_phone_number(attrs.get("phone_number", ""))
        email = str(attrs.get("email", "")).strip().lower()
        gender = str(attrs.get("gender", "") or "").strip().lower()
        attrs["phone_number"] = phone_number
        attrs["email"] = email
        attrs["gender"] = gender

        if not email:
            raise serializers.ValidationError({"email": "L'adresse email est obligatoire."})

        if email_already_used(email):
            raise serializers.ValidationError({"email": "Cette adresse email est deja utilisee."})

        if account_type == "patient":
            if not attrs.get("username", "").strip():
                raise serializers.ValidationError({"username": "Le nom d'utilisateur est obligatoire."})
            if not phone_number:
                raise serializers.ValidationError({"phone_number": "Le numero de telephone est obligatoire."})
            if User.objects.filter(username=attrs["username"].strip()).exists():
                raise serializers.ValidationError({"username": "Ce nom d'utilisateur est deja utilise."})
            if phone_number_already_used(phone_number):
                raise serializers.ValidationError({"phone_number": "Ce numero de telephone est deja utilise."})
        else:
            if not attrs.get("pharmacy_name", "").strip():
                raise serializers.ValidationError({"pharmacy_name": "Le nom de la pharmacie est obligatoire."})
            if not attrs.get("address", "").strip():
                raise serializers.ValidationError({"address": "L'adresse exacte est obligatoire."})
            if not phone_number:
                raise serializers.ValidationError({"phone_number": "Le numero de telephone est obligatoire."})
            if phone_number_already_used(phone_number):
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
                birth_date=validated_data.get("birth_date"),
                gender=validated_data.get("gender", ""),
                latitude=validated_data.get("latitude"),
                longitude=validated_data.get("longitude"),
                location_city=validated_data.get("location_city", "").strip(),
                location_country=validated_data.get("location_country", "").strip(),
                email_verified=False,
            )
            return user

        pharmacy_name = validated_data["pharmacy_name"].strip()
        phone_number = validated_data["phone_number"]
        address = validated_data["address"].strip()
        latitude = validated_data.get("latitude")
        longitude = validated_data.get("longitude")
        location_city = validated_data.get("location_city", "").strip()
        location_country = validated_data.get("location_country", "").strip()
        generated_username = f"{pharmacy_name.lower().replace(' ', '-')[:18]}-{phone_number[-4:]}"
        suffix = 1
        unique_username = generated_username
        while User.objects.filter(username=unique_username).exists():
            suffix += 1
            unique_username = f"{generated_username[:20]}-{suffix}"

        pharmacy = Pharmacy.objects.create(
            name=pharmacy_name,
            profile_image=validated_data.get("pharmacy_image"),
            city=location_city or infer_city(address),
            address=address,
            phone_number=phone_number,
            email=validated_data["email"],
            opening_hours="08:00 - 20:00",
            delivery_supported=False,
            latitude=latitude,
            longitude=longitude,
        )
        user = User.objects.create_user(username=unique_username, email=validated_data["email"], password=password)
        UserProfile.objects.create(
            user=user,
            role="pharmacy",
            phone_number=phone_number,
            whatsapp_number=phone_number,
            address=address,
            latitude=latitude,
            longitude=longitude,
            location_city=location_city,
            location_country=location_country,
            pharmacy=pharmacy,
            email_verified=False,
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
    email = serializers.EmailField()
    password = serializers.CharField(write_only=True, max_length=128)

    def validate(self, attrs):
        password = attrs["password"]
        email = str(attrs["email"]).strip().lower()

        if not email:
            raise serializers.ValidationError({"email": "L'adresse email est obligatoire."})

        user = self._authenticate_with_email(email, password)
        attrs["user"] = user
        return attrs

    def _authenticate_with_email(self, email: str, password: str):
        if email == DEFAULT_ADMIN_EMAIL:
            admin_user = ensure_default_admin_user()
            if admin_user is None:
                raise serializers.ValidationError({"email": "Connexion administrateur indisponible."})
            user = authenticate(username=admin_user.username, password=password)
            if user is None:
                raise serializers.ValidationError({"email": "Email administrateur ou mot de passe invalide."})
            return user

        user = User.objects.filter(email__iexact=email).select_related("profile").first()
        if user is None:
            raise serializers.ValidationError({"email": "Email ou mot de passe invalide."})

        authenticated_user = authenticate(username=user.username, password=password)
        if authenticated_user is None:
            raise serializers.ValidationError({"email": "Email ou mot de passe invalide."})

        self._ensure_email_verified(authenticated_user)
        return authenticated_user

    def _ensure_email_verified(self, user):
        profile = getattr(user, "profile", None)
        if profile is not None and not profile.email_verified:
            raise serializers.ValidationError(
                {
                    "email": "Votre adresse email n'est pas encore verifiee. Verifiez votre boite mail ou demandez un nouveau lien."
                }
            )


class VerifyEmailSerializer(serializers.Serializer):
    token = serializers.CharField()


class ResendVerificationEmailSerializer(serializers.Serializer):
    email = serializers.EmailField()


class GoogleAuthSerializer(serializers.Serializer):
    credential = serializers.CharField()

    def validate(self, attrs):
        token_info = verify_google_credential(attrs["credential"])
        email = str(token_info.get("email", "")).strip().lower()
        sub = str(token_info.get("sub", "")).strip()

        user = User.objects.filter(email__iexact=email).select_related("profile").first()
        if user is None:
            username_seed = token_info.get("name") or email.split("@", 1)[0]
            username = build_unique_username(str(username_seed))
            user = User.objects.create_user(
                username=username,
                email=email,
                password=User.objects.make_random_password(),
            )
            UserProfile.objects.create(
                user=user,
                role="patient",
                email_verified=True,
                google_sub=sub,
            )
        else:
            profile, _ = UserProfile.objects.get_or_create(user=user, defaults={"role": "patient"})
            updated_fields = []
            if not profile.email_verified:
                profile.email_verified = True
                updated_fields.append("email_verified")
            if not profile.google_sub:
                profile.google_sub = sub
                updated_fields.append("google_sub")
            elif profile.google_sub != sub:
                raise serializers.ValidationError({"credential": "Ce compte est deja lie a un autre profil Google."})
            if updated_fields:
                profile.save(update_fields=updated_fields)

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
