import hashlib
import logging
import os
import secrets
from smtplib import SMTPException
from datetime import timedelta

from django.conf import settings
from django.contrib.auth import get_user_model
from django.core.mail import EmailMessage, get_connection, send_mail
from django.db import transaction
from django.utils import timezone
from google.auth.transport import requests as google_requests
from google.oauth2 import id_token as google_id_token

from apps.users.models import EmailVerificationToken, UserProfile

logger = logging.getLogger(__name__)
User = get_user_model()

EMAIL_VERIFICATION_TTL_HOURS = max(int(os.getenv("EMAIL_VERIFICATION_TTL_HOURS", "24")), 1)
GOOGLE_OAUTH_CLIENT_ID = os.getenv("GOOGLE_OAUTH_CLIENT_ID", "").strip()


class EmailVerificationError(Exception):
    pass


class EmailDeliveryError(Exception):
    pass


def hash_verification_token(raw_token: str) -> str:
    return hashlib.sha256(raw_token.encode("utf-8")).hexdigest()


def build_verification_url(raw_token: str) -> str:
    return f"{settings.FRONTEND_URL.rstrip('/')}/verify-email?token={raw_token}"


def email_delivery_uses_console_backend() -> bool:
    return settings.EMAIL_BACKEND == "django.core.mail.backends.console.EmailBackend"


def build_unique_username(base_value: str) -> str:
    normalized = "".join(char.lower() if char.isalnum() else "-" for char in base_value).strip("-")
    normalized = normalized[:30] or "user"
    candidate = normalized
    suffix = 1
    while User.objects.filter(username=candidate).exists():
        suffix += 1
        candidate = f"{normalized[:24]}-{suffix}"
    return candidate


@transaction.atomic
def create_email_verification_token(user) -> str:
    now = timezone.now()
    EmailVerificationToken.objects.filter(user=user, used_at__isnull=True).update(used_at=now)

    raw_token = secrets.token_urlsafe(32)
    EmailVerificationToken.objects.create(
        user=user,
        token_hash=hash_verification_token(raw_token),
        expires_at=now + timedelta(hours=EMAIL_VERIFICATION_TTL_HOURS),
    )
    return raw_token


def send_verification_email(user, raw_token: str) -> dict:
    verification_url = build_verification_url(raw_token)
    message = (
        "Bienvenue sur PharmiGo.\n\n"
        "Confirmez votre adresse email en ouvrant ce lien :\n"
        f"{verification_url}\n\n"
        f"Ce lien expire dans {EMAIL_VERIFICATION_TTL_HOURS} heure(s).\n"
        "Si vous n'etes pas a l'origine de cette inscription, ignorez simplement ce message."
    )
    try:
        send_mail(
            subject="Verifiez votre adresse email PharmiGo",
            message=message,
            from_email=settings.EMAIL_FROM,
            recipient_list=[user.email],
            fail_silently=False,
        )
        return {
            "delivery_mode": "console_preview" if email_delivery_uses_console_backend() else "smtp",
            "verification_url": verification_url,
            "verification_token": raw_token,
        }
    except Exception as exc:
        logger.warning("Verification email delivery failed for %s: %s", user.email, exc)
        if settings.DEBUG:
            console_connection = get_connection("django.core.mail.backends.console.EmailBackend")
            console_message = EmailMessage(
                subject="Verifiez votre adresse email PharmiGo",
                body=message,
                from_email=settings.EMAIL_FROM,
                to=[user.email],
                connection=console_connection,
            )
            console_message.send(fail_silently=True)
            return {
                "delivery_mode": "console_preview",
                "verification_url": verification_url,
                "verification_token": raw_token,
                "delivery_error": str(exc),
            }
        if isinstance(exc, SMTPException):
            raise EmailDeliveryError("Impossible d'envoyer l'email de verification. Verifiez la configuration SMTP.") from exc
        raise EmailDeliveryError("Impossible d'envoyer l'email de verification pour le moment.") from exc


def send_email_verification_for_user(user) -> dict | None:
    if not user.email:
        return None
    raw_token = create_email_verification_token(user)
    return send_verification_email(user, raw_token)


@transaction.atomic
def verify_email_token(raw_token: str):
    token_hash = hash_verification_token(raw_token)
    verification = (
        EmailVerificationToken.objects.select_for_update()
        .select_related("user")
        .filter(token_hash=token_hash)
        .first()
    )
    if verification is None:
        raise EmailVerificationError("Lien de verification invalide.")
    if verification.used_at is not None:
        raise EmailVerificationError("Ce lien de verification a deja ete utilise.")
    if verification.expires_at <= timezone.now():
        raise EmailVerificationError("Ce lien de verification a expire.")

    profile, _ = UserProfile.objects.get_or_create(user=verification.user)
    if not profile.email_verified:
        profile.email_verified = True
        profile.save(update_fields=["email_verified"])

    verification.used_at = timezone.now()
    verification.save(update_fields=["used_at"])
    return verification.user


def verify_google_credential(credential: str) -> dict:
    if not GOOGLE_OAUTH_CLIENT_ID:
        raise EmailVerificationError("La connexion Google n'est pas configuree.")
    try:
        token_info = google_id_token.verify_oauth2_token(
            credential,
            google_requests.Request(),
            GOOGLE_OAUTH_CLIENT_ID,
        )
    except Exception as exc:
        raise EmailVerificationError("Jeton Google invalide.") from exc

    issuer = token_info.get("iss")
    if issuer not in {"accounts.google.com", "https://accounts.google.com"}:
        raise EmailVerificationError("Jeton Google invalide.")

    email = str(token_info.get("email", "")).strip().lower()
    if not email:
        raise EmailVerificationError("Aucune adresse email Google valide n'a ete fournie.")

    if not token_info.get("email_verified"):
        raise EmailVerificationError("Le compte Google doit avoir une adresse email verifiee.")

    return token_info
