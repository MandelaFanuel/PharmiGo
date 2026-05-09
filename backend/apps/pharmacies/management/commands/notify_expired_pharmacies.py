from __future__ import annotations

from datetime import timedelta

from django.core.management.base import BaseCommand
from django.utils import timezone

from apps.notifications.models import Notification
from apps.pharmacies.models import PharmacySubscription
from apps.pharmigo_chatbot.utils import normalize_text
from apps.prescriptions.models import MedicationExtraction, PharmacyStock, Prescription


class Command(BaseCommand):
    help = "Notify expired or inactive pharmacies about missed prescription opportunities."

    def handle(self, *args, **options):
        week_start = timezone.now() - timedelta(days=7)
        subscriptions = PharmacySubscription.objects.select_related("pharmacy").exclude(
            subscription_status="active"
        ).exclude(
            subscription_status="trial",
            is_trial_active=True,
            trial_end_date__gt=timezone.now(),
        )

        created_count = 0
        prescription_ids = list(
            Prescription.objects.filter(created_at__gte=week_start).values_list("id", flat=True)
        )

        for subscription in subscriptions:
            pharmacy = subscription.pharmacy
            if pharmacy is None or not pharmacy.is_active:
                continue

            normalized_stock_names = {
                normalize_text(name)
                for name in PharmacyStock.objects.filter(
                    pharmacy=pharmacy,
                    is_available=True,
                    quantity__gt=0,
                ).values_list("medication_name", flat=True)
            }
            normalized_stock_names = {name for name in normalized_stock_names if name}
            if not normalized_stock_names:
                continue

            matching_prescriptions = 0
            for prescription_id in prescription_ids:
                medication_names = {
                    normalize_text(name)
                    for name in MedicationExtraction.objects.filter(
                        prescription_id=prescription_id,
                        confirmed=True,
                    ).values_list("name", flat=True)
                }
                if medication_names & normalized_stock_names:
                    matching_prescriptions += 1

            if matching_prescriptions <= 0:
                continue

            Notification.objects.create(
                title="Opportunités PharmiGo en attente",
                message=(
                    f"PharmiGo a détecté {matching_prescriptions} ordonnances cette semaine correspondant à votre stock. "
                    "Vos clients potentiels attendent ! Réactivez votre abonnement pour débloquer ces opportunités."
                ),
                channel="messages:pharmacy",
                recipient_pharmacy=pharmacy,
            )
            created_count += 1

        self.stdout.write(
            self.style.SUCCESS(f"{created_count} notification(s) d'incitation créées.")
        )
