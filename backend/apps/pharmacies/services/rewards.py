from __future__ import annotations

import hashlib
import logging
from collections import Counter, defaultdict
from datetime import timedelta

from django.conf import settings
from django.db import transaction
from django.utils import timezone

from apps.notifications.models import Notification
from apps.pharmacies.models import (
    Pharmacy,
    PharmacyReferral,
    PharmacyReferralDeviceLog,
    PharmacyReferralFraudAlert,
    PharmacySubscription,
    SubscriptionSystemSettings,
)
from apps.prescriptions.models import Prescription

logger = logging.getLogger(__name__)

REAL_ACTIVITY_STATUSES = ["served", "patient_confirmed", "completed"]
REWARD_GUIDE_TITLE = "Guide officiel de la promotion ambassadeur PharmiGo"
LEGACY_REWARD_GUIDE_TEXT = (
    "Programme ambassadeur PharmiGo\n\n"
    "1. Partagez votre lien de parrainage avec une autre pharmacie.\n"
    "2. La pharmacie filleule doit soumettre une preuve de paiement validee par l'admin.\n"
    "3. Elle doit ensuite traiter au moins 10 ordonnances reelles.\n"
    "4. Toute activite repetitive suspecte sur le meme appareil est bloquee et remontee a l'administration.\n"
    "5. A partir du seuil de validations configure, PharmiGo ajoute automatiquement des jours gratuits a votre abonnement."
)
PREVIOUS_DEFAULT_REWARD_GUIDE_TEXT = (
    "Promotion ambassadeur PharmiGo\n\n"
    "Objectif\n"
    "Invitez de nouvelles pharmacies serieuses a rejoindre PharmiGo et accompagnez-les jusqu'a leur activation reelle sur le reseau.\n\n"
    "Comment valider un parrainage\n"
    "1. Partagez votre lien unique de parrainage ou votre code unique avec une pharmacie interessee.\n"
    "2. La pharmacie filleule doit creer son compte en utilisant ce lien ou ce code.\n"
    "3. Elle doit soumettre une preuve de paiement verifiee manuellement par l'administration.\n"
    "4. Elle doit ensuite traiter le minimum d'ordonnances reelles exige pour confirmer son activite.\n\n"
    "Regles de securite\n"
    "- Les ordonnances doivent etre reelles et traitees dans le reseau PharmiGo.\n"
    "- Toute activite repetitive suspecte depuis le meme appareil peut bloquer le compteur automatiquement.\n"
    "- En cas d'alerte, l'administration audite le dossier avant toute validation finale.\n\n"
    "Recompense\n"
    "Lorsque vous atteignez le seuil de pharmacies validees defini pour l'evenement, PharmiGo ajoute automatiquement les jours gratuits prevus a votre abonnement. Une pharmacie inactive peut aussi etre reactivee et basculer en statut Verified selon les regles de l'evenement.\n\n"
    "Bonnes pratiques\n"
    "- Partagez uniquement votre lien officiel PharmiGo.\n"
    "- Expliquez clairement a la pharmacie filleule les etapes paiement + activite.\n"
    "- Gardez ce guide comme reference officielle pendant toute la promotion."
)


def reward_extension_enabled() -> bool:
    return bool(getattr(settings, "PHARMIGO_OMNI_REWARD_ENABLED", True))


def get_reward_guide_title() -> str:
    return REWARD_GUIDE_TITLE


def build_default_reward_guide_text(settings_obj: SubscriptionSystemSettings | None = None) -> str:
    threshold = getattr(settings_obj, "reward_referral_threshold", 20) or 20
    min_activity = getattr(settings_obj, "reward_min_activity_count", 10) or 10
    device_limit = getattr(settings_obj, "reward_device_daily_limit", 3) or 3
    bonus_days = getattr(settings_obj, "reward_bonus_days", 90) or 90

    return (
        "Promotion ambassadeur PharmiGo\n\n"
        "Objectif de la promotion\n"
        "Invitez de nouvelles pharmacies serieuses a rejoindre PharmiGo et accompagnez-les jusqu'a leur activation reelle sur le reseau.\n\n"
        "Ce que la pharmacie marraine doit faire\n"
        "1. Partager uniquement son lien officiel PharmiGo de parrainage.\n"
        "2. Expliquer a la pharmacie filleule comment s'inscrire correctement avec ce lien.\n"
        "3. Suivre la progression de la pharmacie filleule jusqu'a la validation complete.\n\n"
        "Conditions pour qu'un parrainage soit valide\n"
        f"1. La pharmacie filleule doit creer son compte via le lien unique du parrain.\n"
        "2. Elle doit soumettre une preuve de paiement validee manuellement par l'administration.\n"
        f"3. Elle doit ensuite confirmer une activite reelle en traitant au moins {min_activity} ordonnances reelles sur PharmiGo.\n"
        "4. Une ordonnance reelle est comptabilisee lorsqu'elle est effectivement servie dans le reseau PharmiGo et confirmee dans le flux normal de la plateforme.\n\n"
        "Regles de securite et anti-fraude\n"
        f"- Un meme appareil ne peut valider que {device_limit} ordonnances maximum par jour pour une pharmacie en cours de validation.\n"
        "- Si une activite repetitive suspecte est detectee sur le meme appareil sur des dates successives, le compteur est bloque et une alerte est envoyee a l'administration.\n"
        "- Seules les activites reelles et verifiables dans PharmiGo sont retenues.\n\n"
        "Recompense officielle\n"
        f"- Lorsque vous atteignez {threshold} pharmacies validees, PharmiGo ajoute automatiquement {bonus_days} jours gratuits a votre abonnement.\n"
        "- Si votre pharmacie etait inactive, elle peut aussi etre reactivee et repasser en statut Verified selon les regles de l'evenement.\n"
        "- La recompense est accordee automatiquement des que le seuil requis est atteint avec des validations conformes.\n\n"
        "Quand une pharmacie filleule passe aux etapes suivantes\n"
        "- Attente paiement: la filleule s'est inscrite mais sa preuve de paiement n'est pas encore validee.\n"
        "- Attente activite: le paiement est valide, mais le minimum d'ordonnances reelles n'est pas encore atteint.\n"
        "- Valide: les conditions paiement + activite sont remplies.\n"
        "- Recompense accordee: le seuil de l'evenement est atteint pour la pharmacie marraine.\n\n"
        "Bonnes pratiques recommandees\n"
        "- Partagez toujours le lien officiel complet, pas un simple texte modifie.\n"
        "- Accompagnez la pharmacie filleule jusqu'a sa premiere vraie activite sur le reseau.\n"
        "- Gardez ce guide comme reference officielle pendant toute la promotion."
    )


def get_default_reward_guide_text(settings_obj: SubscriptionSystemSettings | None = None) -> str:
    return build_default_reward_guide_text(settings_obj)


def get_reward_settings() -> SubscriptionSystemSettings:
    settings_obj = SubscriptionSystemSettings.get_solo()
    normalized_guide = (settings_obj.reward_instructions or "").strip()
    legacy_texts = {
        "",
        LEGACY_REWARD_GUIDE_TEXT.strip(),
        PREVIOUS_DEFAULT_REWARD_GUIDE_TEXT.strip(),
    }
    if normalized_guide in legacy_texts:
        settings_obj.reward_instructions = build_default_reward_guide_text(settings_obj)
        settings_obj.save(update_fields=["reward_instructions", "updated_at"])
    return settings_obj


def ensure_pharmacy_referral_code(pharmacy: Pharmacy | None) -> str:
    if pharmacy is None:
        return ""
    if pharmacy.referral_code:
        return pharmacy.referral_code
    pharmacy.save(update_fields=["referral_code"])
    pharmacy.refresh_from_db(fields=["referral_code"])
    return pharmacy.referral_code


def build_referral_link(pharmacy: Pharmacy | None) -> str:
    if pharmacy is None:
        return ""
    referral_code = ensure_pharmacy_referral_code(pharmacy)
    frontend_url = getattr(settings, "FRONTEND_URL", "").strip().rstrip("/")
    base_url = frontend_url or ""
    return f"{base_url}/register?ref={referral_code}"


def build_request_fingerprint(request) -> str:
    if request is None:
        return "unknown-device"

    explicit = (
        request.headers.get("X-Device-Fingerprint")
        or request.headers.get("X-Device-Id")
        or request.headers.get("X-Pharmigo-Device")
    )
    if explicit:
        return explicit[:120]

    ip_address = (
        request.META.get("HTTP_X_FORWARDED_FOR", "").split(",")[0].strip()
        or request.META.get("REMOTE_ADDR", "").strip()
    )
    user_agent = request.META.get("HTTP_USER_AGENT", "").strip()
    seed = f"{ip_address}|{user_agent}"
    if not seed.strip("|"):
        return "unknown-device"
    return hashlib.sha256(seed.encode("utf-8")).hexdigest()[:32]


def _notify_pharmacy(pharmacy: Pharmacy, title: str, message: str, channel: str = "rewards:pharmacy") -> None:
    Notification.objects.create(title=title, message=message, channel=channel, recipient_pharmacy=pharmacy)


def _notify_admins(title: str, message: str, channel: str = "rewards:admin") -> None:
    from django.contrib.auth import get_user_model

    User = get_user_model()
    for admin_user in User.objects.filter(is_staff=True, is_active=True):
        Notification.objects.create(title=title, message=message, channel=channel, recipient_user=admin_user)


def register_referral_from_code(*, referral_code: str | None, referee: Pharmacy) -> PharmacyReferral | None:
    if not reward_extension_enabled():
        return None

    code = (referral_code or "").strip().upper()
    if not code:
        return None

    referrer = Pharmacy.objects.filter(referral_code__iexact=code).exclude(pk=referee.pk).first()
    if referrer is None:
        return None

    referral, _ = PharmacyReferral.objects.get_or_create(
        referee=referee,
        defaults={"referrer": referrer, "status": "pending_payment"},
    )
    return referral


def evaluate_referral(referral: PharmacyReferral) -> PharmacyReferral:
    settings_obj = get_reward_settings()
    referral.validated_activity_count = Prescription.objects.filter(
        pharmacy=referral.referee,
        status__in=REAL_ACTIVITY_STATUSES,
    ).count()
    referral.last_evaluated_at = timezone.now()

    if referral.status == "fraud_blocked":
        referral.save(update_fields=["validated_activity_count", "last_evaluated_at", "updated_at"])
        return referral

    if referral.payment_validated_at is None:
        referral.status = "pending_payment"
    elif referral.validated_activity_count < settings_obj.reward_min_activity_count:
        referral.status = "pending_activity"
    else:
        referral.status = "validated"

    referral.save(update_fields=["validated_activity_count", "last_evaluated_at", "status", "updated_at"])
    if referral.status == "validated":
        _maybe_grant_referrer_reward(referral.referrer, settings_obj)
    return referral


def _maybe_grant_referrer_reward(referrer: Pharmacy, settings_obj: SubscriptionSystemSettings) -> None:
    validated_count = PharmacyReferral.objects.filter(referrer=referrer, status__in=["validated", "rewarded"]).count()
    if validated_count < settings_obj.reward_referral_threshold:
        return

    subscription, _ = PharmacySubscription.objects.get_or_create(
        pharmacy=referrer,
        defaults={
            "trial_start_date": timezone.now(),
            "trial_end_date": timezone.now() + timedelta(days=settings_obj.trial_period_days),
        },
    )
    base_due_date = subscription.next_payment_due_date or timezone.now()
    if base_due_date < timezone.now():
        base_due_date = timezone.now()
    subscription.subscription_status = "active"
    subscription.is_trial_active = False
    subscription.last_payment_date = timezone.now()
    subscription.next_payment_due_date = base_due_date + timedelta(days=settings_obj.reward_bonus_days)
    subscription.save(
        update_fields=[
            "subscription_status",
            "is_trial_active",
            "last_payment_date",
            "next_payment_due_date",
            "updated_at",
        ]
    )

    if not referrer.is_verified:
        referrer.is_verified = True
        referrer.save(update_fields=["is_verified"])

    PharmacyReferral.objects.filter(referrer=referrer, status="validated").update(
        status="rewarded",
        reward_granted_at=timezone.now(),
        updated_at=timezone.now(),
    )
    _notify_pharmacy(
        referrer,
        "Bonus ambassadeur credite",
        f"Bravo. Vous avez atteint {validated_count} parrainages valides et PharmiGo a ajoute {settings_obj.reward_bonus_days} jours gratuits a votre abonnement.",
    )


def mark_payment_validated_for_pharmacy(pharmacy: Pharmacy, *, verified_by=None, payment_reference: str = "") -> PharmacyReferral | None:
    referral = PharmacyReferral.objects.filter(referee=pharmacy).select_related("referrer", "referee").first()
    if referral is None:
        return None

    referral.payment_validated_at = timezone.now()
    referral.payment_validated_by = verified_by
    if payment_reference:
        referral.payment_reference = payment_reference[:120]
    referral.status = "pending_activity"
    referral.save(
        update_fields=[
            "payment_validated_at",
            "payment_validated_by",
            "payment_reference",
            "status",
            "updated_at",
        ]
    )
    _notify_pharmacy(
        referral.referrer,
        "Paiement filleul valide",
        f"La preuve de paiement de la pharmacie {referral.referee.name} a ete validee. Elle doit maintenant traiter des ordonnances reelles pour finaliser le parrainage.",
    )
    return evaluate_referral(referral)


def record_activity_for_referral(pharmacy: Pharmacy | None, prescription: Prescription, request=None, source_label: str = "") -> PharmacyReferral | None:
    if not reward_extension_enabled() or pharmacy is None:
        return None

    referral = PharmacyReferral.objects.filter(referee=pharmacy).select_related("referrer", "referee").first()
    if referral is None:
        return None

    activity_date = timezone.localdate()
    fingerprint = build_request_fingerprint(request)
    PharmacyReferralDeviceLog.objects.get_or_create(
        referral=referral,
        pharmacy=pharmacy,
        prescription_id=prescription.id,
        device_fingerprint=fingerprint,
        activity_date=activity_date,
        defaults={"source_label": source_label[:80]},
    )

    _evaluate_fraud(referral, fingerprint)
    if referral.status != "fraud_blocked":
        return evaluate_referral(referral)
    return referral


def _evaluate_fraud(referral: PharmacyReferral, current_fingerprint: str) -> None:
    settings_obj = get_reward_settings()
    date_counter: dict[str, Counter] = defaultdict(Counter)

    for log in referral.device_logs.all().order_by("activity_date", "created_at"):
        date_key = log.activity_date.isoformat()
        date_counter[date_key][log.device_fingerprint] += 1

    repeated_dates = [
        date_key
        for date_key, counter in date_counter.items()
        if counter.get(current_fingerprint, 0) > settings_obj.reward_device_daily_limit
    ]
    if len(repeated_dates) < 2:
        return

    message = (
        "Suspicion de fraude : activité répétitive sur le même appareil. "
        f"Appareil {current_fingerprint} au-dessus de la limite journalière sur {', '.join(repeated_dates[:4])}."
    )
    PharmacyReferralFraudAlert.objects.get_or_create(
        referral=referral,
        pharmacy=referral.referee,
        device_fingerprint=current_fingerprint,
        defaults={"repeated_dates": repeated_dates, "message": message},
    )
    referral.status = "fraud_blocked"
    referral.fraud_blocked_at = timezone.now()
    referral.last_evaluated_at = timezone.now()
    referral.save(update_fields=["status", "fraud_blocked_at", "last_evaluated_at", "updated_at"])
    _notify_admins(
        "Suspicion de fraude PharmiGo",
        f"Suspicion de fraude : activité répétitive sur le même appareil pour la pharmacie {referral.referee.name}.",
    )


def build_pharmacy_reward_payload(pharmacy: Pharmacy | None) -> dict:
    settings_obj = get_reward_settings()
    referral_code = ensure_pharmacy_referral_code(pharmacy)
    referral = PharmacyReferral.objects.filter(referrer=pharmacy).select_related("referee").order_by("-updated_at") if pharmacy else PharmacyReferral.objects.none()
    validated_count = referral.filter(status__in=["validated", "rewarded"]).count()
    return {
        "enabled": reward_extension_enabled(),
        "guide_title": get_reward_guide_title(),
        "referral_code": referral_code,
        "referral_link": build_referral_link(pharmacy),
        "threshold": settings_obj.reward_referral_threshold,
        "bonus_days": settings_obj.reward_bonus_days,
        "validated_count": validated_count,
        "progress_ratio": round(min(validated_count / max(settings_obj.reward_referral_threshold, 1), 1), 4),
        "instructions": settings_obj.reward_instructions,
        "event_window": {
            "start": settings_obj.reward_event_start_date,
            "end": settings_obj.reward_event_end_date,
        },
        "referrals": [
            {
                "id": item.id,
                "pharmacy_name": item.referee.name,
                "status": item.status,
                "payment_validated_at": item.payment_validated_at,
                "validated_activity_count": item.validated_activity_count,
                "created_at": item.created_at,
            }
            for item in referral[:50]
        ],
    }


def build_admin_reward_payload() -> dict:
    settings_obj = get_reward_settings()
    referrals = PharmacyReferral.objects.select_related("referrer", "referee", "payment_validated_by").order_by("-updated_at")
    alerts = PharmacyReferralFraudAlert.objects.select_related("referral", "pharmacy").order_by("-created_at")
    return {
        "settings": {
            "reward_guide_title": get_reward_guide_title(),
            "reward_event_start_date": settings_obj.reward_event_start_date,
            "reward_event_end_date": settings_obj.reward_event_end_date,
            "reward_referral_threshold": settings_obj.reward_referral_threshold,
            "reward_min_activity_count": settings_obj.reward_min_activity_count,
            "reward_device_daily_limit": settings_obj.reward_device_daily_limit,
            "reward_bonus_days": settings_obj.reward_bonus_days,
            "reward_instructions": settings_obj.reward_instructions,
        },
        "summary": {
            "referrals_total": referrals.count(),
            "validated_referrals_total": referrals.filter(status__in=["validated", "rewarded"]).count(),
            "fraud_alerts_open": alerts.filter(status="open").count(),
        },
        "referrals": [
            {
                "id": item.id,
                "referrer_id": item.referrer_id,
                "referrer_name": item.referrer.name,
                "referee_id": item.referee_id,
                "referee_name": item.referee.name,
                "status": item.status,
                "payment_validated_at": item.payment_validated_at,
                "payment_validated_by_name": item.payment_validated_by.username if item.payment_validated_by else None,
                "payment_reference": item.payment_reference,
                "validated_activity_count": item.validated_activity_count,
                "fraud_blocked_at": item.fraud_blocked_at,
                "reward_granted_at": item.reward_granted_at,
                "created_at": item.created_at,
                "updated_at": item.updated_at,
            }
            for item in referrals[:200]
        ],
        "fraud_alerts": [
            {
                "id": alert.id,
                "referral_id": alert.referral_id,
                "pharmacy_id": alert.pharmacy_id,
                "pharmacy_name": alert.pharmacy.name,
                "device_fingerprint": alert.device_fingerprint,
                "repeated_dates": alert.repeated_dates,
                "message": alert.message,
                "status": alert.status,
                "created_at": alert.created_at,
            }
            for alert in alerts[:100]
        ],
    }


def safe_register_referral_from_code(*, referral_code: str | None, referee: Pharmacy) -> None:
    try:
        register_referral_from_code(referral_code=referral_code, referee=referee)
    except Exception:
        logger.exception("Unable to register referral from code.")


def safe_mark_payment_validated_for_pharmacy(pharmacy: Pharmacy, *, verified_by=None, payment_reference: str = "") -> None:
    try:
        mark_payment_validated_for_pharmacy(pharmacy, verified_by=verified_by, payment_reference=payment_reference)
    except Exception:
        logger.exception("Unable to mark referral payment validation.")


def safe_record_activity_for_referral(pharmacy: Pharmacy | None, prescription: Prescription, request=None, source_label: str = "") -> None:
    try:
        record_activity_for_referral(pharmacy, prescription, request=request, source_label=source_label)
    except Exception:
        logger.exception("Unable to record referral activity.")
