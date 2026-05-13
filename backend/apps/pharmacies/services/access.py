from __future__ import annotations

from django.conf import settings
from django.db import models
from django.utils import timezone

from apps.pharmacies.models import Pharmacy, PharmacySubscription

PAYMENT_WALL_MESSAGE = (
    "Votre période d'essai est terminée, veuillez activer votre abonnement pour continuer à bénéficier de toutes les fonctionnalités."
)


def trial_restriction_enabled() -> bool:
    return bool(getattr(settings, "PHARMIGO_TRIAL_RESTRICTION_ENABLED", True))


def is_subscription_eligible(subscription: PharmacySubscription | None) -> bool:
    if subscription is None:
        return False

    refresh_subscription_state(subscription)

    now = timezone.now()
    status = (subscription.subscription_status or "").strip().lower()

    if status == "active":
        due_date = getattr(subscription, "next_payment_due_date", None)
        return due_date is None or now <= due_date

    if status == "trial" and subscription.is_trial_active and subscription.trial_end_date:
        return now <= subscription.trial_end_date

    return False


def sync_pharmacy_access_flags(pharmacy: Pharmacy | None, subscription: PharmacySubscription | None) -> None:
    if pharmacy is None or subscription is None:
        return

    # `is_verified` is a business badge managed explicitly by the platform.
    # Subscription eligibility controls private access, but should not silently
    # rewrite the public verification badge.
    return


def refresh_subscription_state(subscription: PharmacySubscription | None) -> PharmacySubscription | None:
    if subscription is None:
        return None

    now = timezone.now()
    updated_fields: list[str] = []
    status = (subscription.subscription_status or "").strip().lower()

    if status == "trial" and subscription.trial_end_date and now > subscription.trial_end_date:
        if subscription.is_trial_active:
            subscription.is_trial_active = False
            updated_fields.append("is_trial_active")
        if subscription.subscription_status != "expired":
            subscription.subscription_status = "expired"
            updated_fields.append("subscription_status")

    if status == "active" and subscription.next_payment_due_date and now > subscription.next_payment_due_date:
        if subscription.subscription_status != "expired":
            subscription.subscription_status = "expired"
            updated_fields.append("subscription_status")
        if subscription.is_trial_active:
            subscription.is_trial_active = False
            updated_fields.append("is_trial_active")

    if updated_fields:
        updated_fields.append("updated_at")
        subscription.save(update_fields=updated_fields)

    return subscription


def is_pharmacy_partner_eligible(pharmacy: Pharmacy | None) -> bool:
    if pharmacy is None or getattr(pharmacy, "is_active", True) is False:
        return False

    try:
        subscription = PharmacySubscription.objects.get(pharmacy_id=pharmacy.id)
    except PharmacySubscription.DoesNotExist:
        return False

    eligible = is_subscription_eligible(subscription)
    sync_pharmacy_access_flags(pharmacy, subscription)

    if not eligible:
        return False

    status = (subscription.subscription_status or "").strip().lower()
    if status == "trial":
        return True
    if status == "active":
        return bool(getattr(pharmacy, "is_verified", False))
    return False


def pharmacy_has_platform_access(pharmacy: Pharmacy | None) -> bool:
    if pharmacy is None:
        return False
    if not trial_restriction_enabled():
        return bool(getattr(pharmacy, "is_active", True))
    try:
        subscription = PharmacySubscription.objects.get(pharmacy_id=pharmacy.id)
    except PharmacySubscription.DoesNotExist:
        return False
    sync_pharmacy_access_flags(pharmacy, subscription)
    return bool(getattr(pharmacy, "is_active", True)) and is_subscription_eligible(subscription)


def get_active_partner_pharmacies():
    if not trial_restriction_enabled():
        return Pharmacy.objects.filter(is_active=True)

    now = timezone.now()
    return Pharmacy.objects.filter(is_active=True).filter(
        models.Q(
            subscription__subscription_status="active",
        )
        & (models.Q(subscription__next_payment_due_date__isnull=True) | models.Q(subscription__next_payment_due_date__gt=now))
        | models.Q(
            subscription__subscription_status="trial",
            subscription__is_trial_active=True,
            subscription__trial_end_date__gt=now,
        )
    )
