import logging

from apps.prescriptions.models import Prescription
from apps.prescriptions.serializers import PrescriptionSerializer
from apps.prescriptions.services.pharmacy_recommendation_service import PharmacyRecommendationService
from pharmigo.api import broadcast_feed_event, create_targeted_notification

logger = logging.getLogger(__name__)


class PharmiGoChatbotOrchestrator:
    """Coordinate chatbot actions after prescription milestones."""

    def __init__(self):
        self.recommendation_service = PharmacyRecommendationService()

    def on_prescription_uploaded(self, prescription_id):
        logger.info("[CHATBOT] prescription_uploaded prescription_id=%s", prescription_id)
        self._broadcast_simple("prescription_uploaded", prescription_id, "Ordonnance reçue. L'analyse intelligente démarre.")

    def on_medicines_detected(self, prescription_id):
        logger.info("[CHATBOT] medicines_detected prescription_id=%s", prescription_id)
        self._broadcast_simple("prescription_analyzed", prescription_id, "Les médicaments détectés sont prêts pour confirmation.")

    def on_patient_confirmed_medicines(self, prescription_id, user=None):
        logger.info("[CHATBOT] patient_confirmed_medicines prescription_id=%s", prescription_id)
        prescription = Prescription.objects.select_related("patient_user", "pharmacy").get(id=prescription_id)
        self._broadcast_simple(
            "medicines_confirmed",
            prescription_id,
            "J'ai bien enregistré mes médicaments. Je recherche maintenant les pharmacies disponibles.",
        )
        return self.search_pharmacies_for_prescription(prescription_id, user or prescription.patient_user)

    def search_pharmacies_for_prescription(self, prescription_id, user=None):
        prescription = Prescription.objects.select_related("patient_user", "pharmacy").get(id=prescription_id)
        broadcast_feed_event(
            "chatbot_search_started",
            {
                "prescription_id": prescription.id,
                "status": "searching",
            },
        )
        result = self.recommendation_service.generate_for_prescription(prescription, user=user)
        recommendations = result.get("recommendations", [])
        message = self.build_recommendation_message(recommendations, fallback=result.get("message"))

        if recommendations:
            prescription.status = "searching"
        else:
            prescription.status = "confirmed"
        prescription.notes = message
        prescription.save(update_fields=["status", "notes", "updated_at"])

        if recommendations:
            self.notify_patient_recommendations_ready(prescription_id, recommendations, message)
        else:
            create_targeted_notification(
                title="Recherche pharmacie terminée",
                message=message,
                channel="prescriptions:patient",
                recipient_user=prescription.patient_user,
            )
            broadcast_feed_event(
                "recommendations_ready",
                {
                    "prescription_id": prescription.id,
                    "status": "empty",
                    "message": message,
                    "recommendations": [],
                },
            )

        return {
            "status": "ready" if recommendations else "empty",
            "message": message,
            "recommendations": recommendations,
        }

    def build_recommendation_message(self, recommendations, fallback=None):
        if recommendations:
            complete_count = sum(1 for item in recommendations if item.get("availability") == "complete")
            if complete_count:
                return "J'ai trouvé les pharmacies suivantes qui possèdent mes médicaments."
            return "Aucune pharmacie ne possède tous mes médicaments. Voici les pharmacies qui en possèdent une partie."
        return fallback or "Je n'ai trouvé aucune pharmacie disponible pour le moment."

    def notify_patient_recommendations_ready(self, prescription_id, recommendations, message=None):
        prescription = Prescription.objects.select_related("patient_user").get(id=prescription_id)
        message = message or self.build_recommendation_message(recommendations)
        create_targeted_notification(
            title="Pharmacies trouvées",
            message=message,
            channel="prescriptions:patient",
            recipient_user=prescription.patient_user,
        )
        serialized = PrescriptionSerializer(prescription).data
        broadcast_feed_event(
            "recommendations_ready",
            {
                "prescription_id": prescription.id,
                "status": "ready",
                "message": message,
                "recommendations": recommendations,
                "prescription": serialized,
            },
        )

    @staticmethod
    def _broadcast_simple(event_type, prescription_id, message):
        broadcast_feed_event(
            event_type,
            {
                "prescription_id": prescription_id,
                "message": message,
            },
        )
