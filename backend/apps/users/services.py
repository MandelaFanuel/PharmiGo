import hashlib
import json
import logging
import os
import secrets
from datetime import timedelta
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

from django.conf import settings
from django.contrib.auth import get_user_model
from django.core.mail import EmailMessage, EmailMultiAlternatives, get_connection
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
    return bool(getattr(settings, "DEBUG", False))


def smtp_email_configured() -> bool:
    return bool(getattr(settings, "SMTP_HOST", "").strip() and getattr(settings, "SMTP_USER", "").strip())


def resend_api_configured() -> bool:
    return bool(getattr(settings, "RESEND_API_KEY", "").strip())


def send_smtp_transactional_email(subject: str, message: str, recipient_email: str, html_message: str | None = None) -> dict:
    if not smtp_email_configured():
        raise EmailDeliveryError("La configuration SMTP est absente.")

    connection = get_connection(
        backend="django.core.mail.backends.smtp.EmailBackend",
        host=settings.SMTP_HOST,
        port=settings.SMTP_PORT,
        username=settings.SMTP_USER,
        password=settings.SMTP_PASSWORD,
        use_tls=settings.EMAIL_USE_TLS,
        use_ssl=settings.EMAIL_USE_SSL,
        timeout=getattr(settings, "EMAIL_TIMEOUT", 20),
    )
    email = EmailMultiAlternatives(
        subject=subject,
        body=message,
        from_email=settings.EMAIL_FROM,
        to=[recipient_email],
        connection=connection,
    )
    if html_message:
        email.attach_alternative(html_message, "text/html")
    try:
        email.send(fail_silently=False)
        return {
            "delivery_mode": "smtp",
            "provider_message_id": None,
        }
    except Exception as exc:
        logger.warning("SMTP delivery failed for %s: %s", recipient_email, exc)
        raise EmailDeliveryError("Impossible d'envoyer l'email pour le moment via SMTP.") from exc


def send_transactional_email(subject: str, message: str, recipient_email: str, html_message: str | None = None) -> dict:
    if smtp_email_configured():
        return send_smtp_transactional_email(
            subject=subject,
            message=message,
            recipient_email=recipient_email,
            html_message=html_message,
        )
    if not resend_api_configured():
        raise EmailDeliveryError("Aucun service d'email n'est configure.")

    payload = json.dumps(
        {
            "from": settings.RESEND_FROM_EMAIL,
            "to": [recipient_email],
            "subject": subject,
            "text": message,
            "html": html_message or message.replace("\n", "<br>"),
        }
    ).encode("utf-8")
    request = Request(
        settings.RESEND_API_URL,
        data=payload,
        headers={
            "Authorization": f"Bearer {settings.RESEND_API_KEY}",
            "Content-Type": "application/json",
        },
        method="POST",
    )
    try:
        with urlopen(request, timeout=20) as response:
            response_body = response.read().decode("utf-8") if response else ""
            response_data = json.loads(response_body) if response_body else {}
            return {
                "delivery_mode": "resend_api",
                "provider_message_id": response_data.get("id"),
            }
    except HTTPError as exc:
        error_body = exc.read().decode("utf-8", errors="replace")
        logger.warning("Resend API delivery failed for %s: %s %s", recipient_email, exc.code, error_body)
        raise EmailDeliveryError("Impossible d'envoyer l'email pour le moment via Resend.") from exc
    except URLError as exc:
        logger.warning("Resend API unreachable for %s: %s", recipient_email, exc)
        raise EmailDeliveryError("Le service d'emails est momentanement inaccessible.") from exc


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
    subject = "Verifiez votre adresse email PharmiGo"
    message = (
        "Bienvenue sur PharmiGo.\n\n"
        "Confirmez votre adresse email en ouvrant ce lien :\n"
        f"{verification_url}\n\n"
        f"Ce lien expire dans {EMAIL_VERIFICATION_TTL_HOURS} heure(s).\n"
        "Si vous n'etes pas a l'origine de cette inscription, ignorez simplement ce message."
    )
    first_name = (getattr(user, "first_name", "") or getattr(user, "username", "") or "cher utilisateur").strip()
    html_message = f"""
<!DOCTYPE html>
<html lang="fr">
  <body style="margin:0;padding:0;background:#0f172a;font-family:Arial,sans-serif;">
    <div style="padding:32px 16px;background:linear-gradient(135deg,#f8fbff 0%,#e8f6ff 52%,#d8f3f0 100%);">
      <div style="max-width:640px;margin:0 auto;background:#ffffff;border:1px solid #dbe7f5;border-radius:24px;overflow:hidden;box-shadow:0 24px 60px rgba(15,23,42,0.14);">
        <div style="padding:20px 24px;background:linear-gradient(135deg,#1f8a96 0%,#3f83f8 100%);color:#ffffff;">
          <div style="font-size:12px;letter-spacing:0.18em;font-weight:700;text-transform:uppercase;opacity:0.92;">PharmiGo</div>
          <h1 style="margin:12px 0 0;font-size:30px;line-height:1.15;font-weight:800;">Confirmez votre adresse email</h1>
        </div>
        <div style="padding:28px 24px 32px;color:#16324f;">
          <p style="margin:0 0 14px;font-size:16px;line-height:1.7;">Bonjour {first_name},</p>
          <p style="margin:0 0 18px;font-size:16px;line-height:1.7;">
            Merci d'avoir rejoint PharmiGo. Pour activer votre compte en toute securite, confirmez votre email en cliquant sur le bouton ci-dessous.
          </p>
          <div style="margin:28px 0;text-align:center;">
            <a href="{verification_url}" style="display:inline-block;padding:18px 34px;background:#3f83f8;color:#ffffff;text-decoration:none;font-size:18px;font-weight:700;border-radius:999px;box-shadow:0 16px 32px rgba(63,131,248,0.28);">
              Confirm your email
            </a>
          </div>
          <p style="margin:0 0 10px;font-size:15px;line-height:1.7;">
            Ce lien expire dans <strong>{EMAIL_VERIFICATION_TTL_HOURS} heure(s)</strong>.
          </p>
          <p style="margin:0 0 14px;font-size:15px;line-height:1.7;">
            Si le bouton ne fonctionne pas, copiez ce lien dans votre navigateur :
          </p>
          <p style="margin:0 0 18px;padding:14px 16px;background:#f6fbff;border:1px solid #dbe7f5;border-radius:16px;font-size:14px;line-height:1.7;word-break:break-all;">
            {verification_url}
          </p>
          <p style="margin:0;font-size:14px;line-height:1.7;color:#5b7492;">
            Si vous n'etes pas a l'origine de cette inscription, ignorez simplement cet email.
          </p>
        </div>
      </div>
    </div>
  </body>
</html>
""".strip()
    try:
        delivery = send_transactional_email(
            subject=subject,
            message=message,
            recipient_email=user.email,
            html_message=html_message,
        )
        delivery.update(
            {
                "verification_url": verification_url,
                "verification_token": raw_token,
            }
        )
        return delivery
    except Exception as exc:
        logger.warning("Verification email delivery failed for %s: %s", user.email, exc)
        if settings.DEBUG:
            fallback_backend = getattr(settings, "EMAIL_BACKEND", "") or "django.core.mail.backends.console.EmailBackend"
            console_connection = get_connection(fallback_backend)
            console_message = EmailMessage(
                subject=subject,
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
