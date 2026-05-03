import logging

from django.contrib.auth import logout
from django.contrib.auth import get_user_model
from django.contrib.auth.tokens import default_token_generator
from django.core.mail import send_mail
from django.utils.encoding import force_str
from django.utils.http import urlsafe_base64_decode
from django.conf import settings
from rest_framework import generics, status
from rest_framework.authtoken.models import Token
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.pharmacies.serializers import PharmacySerializer
from apps.users.location import refresh_profile_location_from_request
from .serializers import (
    LoginSerializer,
    PasswordResetConfirmSerializer,
    PasswordResetRequestSerializer,
    RegisterSerializer,
    UserSerializer,
    build_password_reset_payload,
)
from apps.users.models import UserProfile
from pharmigo.api import broadcast_feed_event

User = get_user_model()
logger = logging.getLogger(__name__)


def issue_auth_token(user):
    Token.objects.filter(user=user).delete()
    return Token.objects.create(user=user)


class UserListView(generics.ListAPIView):
    queryset = User.objects.all().order_by("id")
    serializer_class = UserSerializer


class UserDetailView(generics.RetrieveAPIView):
    queryset = User.objects.all()
    serializer_class = UserSerializer


class RegisterView(APIView):
    def post(self, request):
        serializer = RegisterSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        user = serializer.save()
        token = issue_auth_token(user)
        if getattr(getattr(user, "profile", None), "role", None) == "pharmacy" and getattr(user.profile, "pharmacy", None) is not None:
            broadcast_feed_event("pharmacy.created", PharmacySerializer(user.profile.pharmacy).data)
        return Response(
            {
                "message": "Inscription reussie.",
                "user": UserSerializer(user).data,
                "token": token.key,
            },
            status=status.HTTP_201_CREATED,
        )


class LoginView(APIView):
    def post(self, request):
        serializer = LoginSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        user = serializer.validated_data["user"]
        profile = getattr(user, "profile", None)
        if profile is not None:
            refresh_profile_location_from_request(profile, request)
        token = issue_auth_token(user)
        return Response(
            {
                "message": "Connexion reussie.",
                "user": UserSerializer(user).data,
                "token": token.key,
            }
        )


class LogoutView(APIView):
    def post(self, request):
        user = getattr(request, "user", None)
        if user is not None and getattr(user, "is_authenticated", False):
            profile = getattr(user, "profile", None)
            if profile is not None:
                profile.force_offline()
            Token.objects.filter(user=user).delete()

        raw_request = getattr(request, "_request", None)
        if raw_request is not None:
            logout(raw_request)

        return Response({"message": "Deconnexion reussie."}, status=status.HTTP_200_OK)


class PasswordResetRequestView(APIView):
    def post(self, request):
        serializer = PasswordResetRequestSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        email = serializer.validated_data["email"].strip().lower()

        user = User.objects.filter(email__iexact=email).first()
        if user is None:
            profile = (
                UserProfile.objects.select_related("user", "pharmacy")
                .filter(role="pharmacy", pharmacy__email__iexact=email)
                .first()
            )
            user = profile.user if profile is not None else None

        if user is not None:
            payload = build_password_reset_payload(user)
            reset_url = f"{settings.FRONTEND_APP_URL.rstrip('/')}/reset-password?uid={payload['uid']}&token={payload['token']}"
            message = (
                "Vous avez demande la reinitialisation de votre mot de passe PharmiGo.\n\n"
                f"Ouvrez ce lien pour definir un nouveau mot de passe : {reset_url}\n\n"
                "Si vous n'etes pas a l'origine de cette demande, ignorez simplement ce message."
            )
            try:
                send_mail(
                    subject="Reinitialisation de votre mot de passe PharmiGo",
                    message=message,
                    from_email=settings.DEFAULT_FROM_EMAIL,
                    recipient_list=[email],
                    fail_silently=False,
                )
            except Exception as exc:
                logger.warning("Password reset email could not be sent: %s", exc)

        return Response(
            {
                "message": "Si cette adresse existe dans PharmiGo, un lien de reinitialisation vient d'etre envoye."
            },
            status=status.HTTP_200_OK,
        )


class PasswordResetConfirmView(APIView):
    def post(self, request):
        serializer = PasswordResetConfirmSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)

        try:
            user_id = force_str(urlsafe_base64_decode(serializer.validated_data["uid"]))
            user = User.objects.get(pk=user_id)
        except Exception:
            return Response({"token": ["Lien de reinitialisation invalide ou expire."]}, status=status.HTTP_400_BAD_REQUEST)

        token = serializer.validated_data["token"]
        if not default_token_generator.check_token(user, token):
            return Response({"token": ["Lien de reinitialisation invalide ou expire."]}, status=status.HTTP_400_BAD_REQUEST)

        user.set_password(serializer.validated_data["new_password"])
        user.save(update_fields=["password"])
        return Response({"message": "Votre mot de passe a ete reinitialise avec succes."}, status=status.HTTP_200_OK)
