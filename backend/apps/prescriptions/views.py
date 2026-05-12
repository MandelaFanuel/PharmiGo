import logging
import os

from django.conf import settings
from django.db import transaction
from django.http import FileResponse
from rest_framework import generics, serializers, status, views
from rest_framework.authentication import get_authorization_header
from rest_framework.parsers import FormParser, MultiPartParser
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from django.utils import timezone
from rest_framework.authtoken.models import Token

from apps.common.storage import build_private_prescription_name, private_prescription_storage
from .models import (
    AnalysisLog,
    MedicationExtraction,
    PharmacyStock,
    Prescription,
    PrescriptionAnalysisTask,
    PrescriptionStatusHistory,
)
from .serializers import PrescriptionSerializer, PharmacyStockSerializer
from .services.analysis_task_service import AnalysisTaskService
from .services.pharmacy_recommendation_service import PharmacyRecommendationService
from .services.qa_service import QAService
from apps.pharmigo_chatbot.orchestrator import PharmiGoChatbotOrchestrator
from apps.pharmigo_chatbot.models import ChatbotLearningData
from apps.pharmacies.permissions import IsPharmacySubscriptionActiveOrTrial
from apps.pharmacies.services.access import PAYMENT_WALL_MESSAGE, is_pharmacy_partner_eligible, pharmacy_has_platform_access
from apps.pharmacies.services.rewards import safe_record_activity_for_referral
from pharmigo.api import broadcast_feed_event, create_targeted_notification, get_request_user, pharmacy_subscription_is_active

logger = logging.getLogger(__name__)


def _format_prescription_reference(prescription):
    return prescription.public_reference or "ORD-INCONNUE"


def _is_admin_user(user):
    return bool(user and getattr(user, "is_staff", False))


def _is_prescription_owner(user, prescription):
    return bool(user and prescription.patient_user_id and user.id == prescription.patient_user_id)


def _is_selected_pharmacy_user(user, prescription):
    profile = getattr(user, "profile", None)
    return bool(profile and profile.role == "pharmacy" and profile.pharmacy_id and profile.pharmacy_id == prescription.pharmacy_id)


def _can_view_prescription_document(user, prescription):
    return _is_admin_user(user) or _is_prescription_owner(user, prescription) or _is_selected_pharmacy_user(user, prescription)


def _can_manage_patient_prescription(user, prescription):
    return _is_admin_user(user) or _is_prescription_owner(user, prescription)


def _get_profile_created_at(user):
    profile = getattr(user, "profile", None)
    return getattr(profile, "created_at", None)


def _derive_geo_zone(request):
    raw_zone = str(request.data.get("geo_zone") or "").strip()
    if raw_zone:
        return raw_zone[:120]

    profile = getattr(request.user, "profile", None)
    address = str(getattr(profile, "address", "") or "").strip()
    if not address:
        return "Zone non renseignee"

    parts = [part.strip() for part in address.split(",") if part.strip()]
    return (parts[-1] if parts else address)[:120]


def _resolve_request_user(request):
    user = getattr(request, "user", None)
    if user is not None and getattr(user, "is_authenticated", False):
        return user

    auth = get_authorization_header(request).split()
    if len(auth) != 2:
        return None

    try:
        scheme = auth[0].decode("utf-8").lower()
        token_key = auth[1].decode("utf-8")
    except UnicodeError:
        return None

    if scheme not in {"token", "bearer"}:
        return None

    try:
        token = Token.objects.select_related("user__profile").get(key=token_key)
    except Token.DoesNotExist:
        return None

    return token.user


def _build_confirmed_medication_summary(prescription):
    confirmed_medications = list(
        prescription.extracted_medications.filter(confirmed=True).order_by("-confidence", "id")
    )
    if not confirmed_medications:
        return "Aucun médicament confirmé."

    summary_items = []
    for medication in confirmed_medications[:10]:
        parts = [medication.name]
        if medication.dosage:
            parts.append(medication.dosage)
        if medication.quantity:
            parts.append(f"Qté {medication.quantity}")
        summary_items.append(" • ".join(parts))
    suffix = " ..." if len(confirmed_medications) > 10 else ""
    return "; ".join(summary_items) + suffix


def _get_visible_prescription_queryset(request):
    user = get_request_user(request)
    queryset = Prescription.objects.select_related("pharmacy", "patient_user").prefetch_related(
        "responses__pharmacy",
        "comments__user__profile__pharmacy",
        "extracted_medications",
    ).defer("total_amount").exclude(status__in=["error", "cancelled"])

    if _is_admin_user(user):
        return queryset

    profile = getattr(user, "profile", None)
    if profile is None:
        return queryset.none()

    if profile.role == "patient":
        patient_start_at = _get_profile_created_at(user)
        patient_queryset = queryset.filter(patient_user=user)
        if patient_start_at is not None:
            patient_queryset = patient_queryset.filter(created_at__gte=patient_start_at)
        return patient_queryset

    if profile.role == "pharmacy":
        if not pharmacy_has_platform_access(getattr(profile, "pharmacy", None)):
            return queryset.none()
        return queryset.filter(
            status__in=[
                "uploaded",
                "analyzing",
                "confirmation_pending",
                "confirmed",
                "confirmed_unavailable",
                "searching",
                "pharmacy_selected",
                "preparing",
                "ready",
                "served",
                "patient_confirmed",
                "completed",
            ]
        )

    return queryset.none()


class PrescriptionListView(generics.ListAPIView):
    permission_classes = [IsAuthenticated]
    serializer_class = PrescriptionSerializer
    parser_classes = [MultiPartParser, FormParser]

    def get_queryset(self):
        return _get_visible_prescription_queryset(self.request)


class PrescriptionUploadView(views.APIView):
    """Upload prescription and schedule hybrid analysis."""
    parser_classes = [MultiPartParser, FormParser]
    permission_classes = []

    def _get_profile(self, user):
        try:
            return getattr(user, "profile", None)
        except Exception:
            return None
    
    def post(self, request):
        user = _resolve_request_user(request)
        if user is None:
            return Response({"detail": "Informations d'authentification non fournies."}, status=status.HTTP_401_UNAUTHORIZED)

        profile = self._get_profile(user)
        if profile is None or profile.role not in {"patient", "admin"}:
            return Response({"error": "Seuls les patients autorises peuvent envoyer une ordonnance."}, status=status.HTTP_403_FORBIDDEN)

        image_file = (
            request.FILES.get("prescription_image")
            or request.FILES.get("image")
            or request.FILES.get("file")
        )
        uploaded_file = request.FILES.get("prescription_file") or request.FILES.get("file") or image_file
        text_input = str(request.data.get("analysis_text", "")).strip()
        patient_name = request.data.get("patient_name") or user.username
        patient_email = request.data.get("patient_email") or user.email or f"{user.username}@pharmigo.local"
        medication_name = request.data.get("medication_name") or "Ordonnance medicale"
        dosage = request.data.get("dosage") or "Analyse ordonnance"
        instructions = request.data.get("instructions") or "Ordonnance soumise depuis PharmiGo."
        request.user = user
        geo_zone = _derive_geo_zone(request)

        if not patient_name:
            return Response({"error": "patient_name is required"}, status=status.HTTP_400_BAD_REQUEST)

        if image_file is None and uploaded_file is not None:
            content_type = getattr(uploaded_file, "content_type", "") or ""
            file_name = getattr(uploaded_file, "name", "") or ""
            if content_type.startswith("image/") or file_name.lower().endswith((".png", ".jpg", ".jpeg", ".webp", ".bmp")):
                image_file = uploaded_file

        if uploaded_file is None and not text_input:
            return Response({"error": "No prescription image or text provided"}, status=status.HTTP_400_BAD_REQUEST)

        private_document_name = ""
        private_document_original_name = ""
        document_content_type = ""
        if uploaded_file is not None:
            private_document_original_name = getattr(uploaded_file, "name", "") or "ordonnance"
            document_content_type = getattr(uploaded_file, "content_type", "") or ""
            private_document_name = private_prescription_storage.save(
                build_private_prescription_name(private_document_original_name),
                uploaded_file,
            )

        try:
            prescription = Prescription.objects.create(
                patient_name=patient_name,
                patient_email=patient_email,
                geo_zone=geo_zone,
                patient_user=user,
                medication_name=medication_name,
                dosage=dosage,
                instructions=instructions,
                private_document_name=private_document_name,
                private_document_original_name=private_document_original_name,
                document_content_type=document_content_type,
                status='uploaded',
                ocr_text=text_input or "",
            )
        except Exception as e:
            return Response({"error": f"Failed to create prescription: {str(e)}"}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)

        task = PrescriptionAnalysisTask.objects.create(prescription=prescription, status="queued")
        AnalysisLog.objects.create(
            task=task,
            prescription=prescription,
            stage="upload",
            level="info",
            message="Ordonnance uploadée avec succès.",
            payload={"has_document": bool(private_document_name), "has_text_input": bool(text_input)},
        )
        PrescriptionStatusHistory.objects.create(
            prescription=prescription,
            status="uploaded",
            changed_by=user,
            notes="Ordonnance recue et planifiee pour analyse hybride.",
        )
        transaction.on_commit(lambda: AnalysisTaskService().enqueue(task.task_id))
        transaction.on_commit(lambda: PharmiGoChatbotOrchestrator().on_prescription_uploaded(prescription.id))

        return Response(
            {
                "status": "success",
                "task_id": str(task.task_id),
                "prescription_id": prescription.id,
                "message": "Ordonnance uploadée avec succès. L'analyse intelligente est en cours.",
                "medication_name": prescription.medication_name,
                "task_status": task.status,
            },
            status=status.HTTP_202_ACCEPTED,
        )


class PrescriptionDetailView(generics.RetrieveAPIView):
    """Get prescription details"""
    permission_classes = [IsAuthenticated]
    serializer_class = PrescriptionSerializer
    lookup_field = 'id'

    def get_queryset(self):
        return _get_visible_prescription_queryset(self.request)


class PrescriptionAnalyzeView(views.APIView):
    """Re-analyze an existing prescription."""
    permission_classes = [IsAuthenticated]

    def post(self, request, prescription_id):
        try:
            prescription = Prescription.objects.get(id=prescription_id)
        except Prescription.DoesNotExist:
            return Response({"error": "Prescription not found"}, status=status.HTTP_404_NOT_FOUND)
        if not _can_manage_patient_prescription(request.user, prescription):
            return Response({"error": "Access denied"}, status=status.HTTP_403_FORBIDDEN)

        text_input = str(request.data.get("analysis_text", "")).strip()
        if text_input:
            prescription.ocr_text = text_input
            prescription.save(update_fields=["ocr_text", "updated_at"])

        task = PrescriptionAnalysisTask.objects.create(prescription=prescription, status="queued")
        AnalysisLog.objects.create(
            task=task,
            prescription=prescription,
            stage="reanalyze",
            level="info",
            message="Réanalyse demandée par le patient.",
        )
        transaction.on_commit(lambda: AnalysisTaskService().enqueue(task.task_id))
        return Response(
            {
                "status": "success",
                "task_id": str(task.task_id),
                "prescription_id": prescription.id,
                "task_status": task.status,
                "message": "Réanalyse lancée.",
            },
            status=status.HTTP_202_ACCEPTED,
        )


class PrescriptionAnalysisTaskStatusView(views.APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request, task_id):
        try:
            task = PrescriptionAnalysisTask.objects.select_related("prescription").get(task_id=task_id)
        except PrescriptionAnalysisTask.DoesNotExist:
            return Response({"error": "Task not found"}, status=status.HTTP_404_NOT_FOUND)
        if not _can_manage_patient_prescription(request.user, task.prescription):
            return Response({"error": "Access denied"}, status=status.HTTP_403_FORBIDDEN)
        return Response(AnalysisTaskService().serialize_task(task, request=request), status=status.HTTP_200_OK)


class ConfirmPrescriptionView(views.APIView):
    permission_classes = [IsAuthenticated]

    def post(self, request):
        prescription_id = request.data.get("prescription_id")
        if not prescription_id:
            return Response({"error": "prescription_id is required"}, status=status.HTTP_400_BAD_REQUEST)
        return PrescriptionConfirmMedicationsView().post(request, prescription_id)


class PrescriptionConfirmMedicationsView(views.APIView):
    """Confirm medications extracted from prescription"""
    permission_classes = [IsAuthenticated]
    
    def post(self, request, prescription_id):
        try:
            prescription = Prescription.objects.get(id=prescription_id)
        except Prescription.DoesNotExist:
            return Response(
                {'error': 'Prescription not found'},
                status=status.HTTP_404_NOT_FOUND
            )
        if not _can_manage_patient_prescription(request.user, prescription):
            return Response({"error": "Access denied"}, status=status.HTTP_403_FORBIDDEN)

        medications_data = request.data.get('medications', [])
        learning_events_created = 0
        submitted_ids = {
            int(med_data["id"])
            for med_data in medications_data
            if med_data.get("id") is not None
        }

        if submitted_ids:
            removed_medications = prescription.extracted_medications.exclude(id__in=submitted_ids)
            for removed in removed_medications:
                ChatbotLearningData.objects.create(
                    original_text=removed.name,
                    original_gemini_text=prescription.ocr_text or "",
                    detected_intent="prescription_item_removed",
                    detected_medicine=removed.name,
                    corrected_medicine="",
                    detected_dosage=removed.dosage or "",
                    corrected_dosage="",
                    detected_form=removed.form or removed.unit or "",
                    corrected_form="",
                    detected_posology=removed.posology or "",
                    corrected_posology="",
                    corrected_answer=f"Le patient a supprimé {removed.name} de la liste confirmée.",
                    source="patient",
                    confidence_before=removed.confidence,
                    confidence_after=0.0,
                    prescription=prescription,
                    user=request.user,
                )
                learning_events_created += 1
            removed_medications.delete()

        # Update medication confirmations
        for med_data in medications_data:
            try:
                medication = MedicationExtraction.objects.get(
                    id=med_data['id'],
                    prescription=prescription
                )
                previous_name = medication.name
                previous_dosage = medication.dosage or ""
                previous_form = medication.form or medication.unit or ""
                previous_posology = medication.posology or ""
                previous_confidence = medication.confidence
                medication.confirmed = med_data.get('confirmed', False)
                if med_data.get('corrected_name'):
                    medication.name = med_data['corrected_name']
                if med_data.get('dosage') is not None:
                    medication.dosage = med_data.get('dosage') or ""
                if med_data.get('form') is not None:
                    medication.form = med_data.get('form') or ""
                    medication.unit = med_data.get('form') or medication.unit
                if med_data.get('quantity') is not None:
                    try:
                        medication.quantity = max(1, int(med_data.get('quantity') or 1))
                    except (TypeError, ValueError):
                        medication.quantity = max(1, medication.quantity or 1)
                if med_data.get('posology') is not None:
                    medication.posology = med_data.get('posology') or ""
                medication.save()
                corrected_name = str(med_data.get("corrected_name") or "").strip()
                corrected_dosage = str(med_data.get("dosage") or "").strip()
                corrected_form = str(med_data.get("form") or "").strip()
                corrected_posology = str(med_data.get("posology") or "").strip()
                if (
                    corrected_name and corrected_name != previous_name
                ) or corrected_dosage != previous_dosage or corrected_form != previous_form or corrected_posology != previous_posology:
                    ChatbotLearningData.objects.create(
                        original_text=previous_name,
                        original_gemini_text=prescription.ocr_text or "",
                        detected_intent="prescription_confirmation",
                        detected_medicine=previous_name,
                        corrected_medicine=corrected_name,
                        detected_dosage=previous_dosage,
                        corrected_dosage=corrected_dosage,
                        detected_form=previous_form,
                        corrected_form=corrected_form,
                        detected_posology=previous_posology,
                        corrected_posology=corrected_posology,
                        corrected_answer=f"Le patient a confirmé ou corrigé {previous_name} en {corrected_name}.",
                        source=getattr(getattr(request.user, "profile", None), "role", "patient"),
                        confidence_before=previous_confidence,
                        confidence_after=1.0,
                        prescription=prescription,
                        user=request.user,
                    )
                    learning_events_created += 1
            except MedicationExtraction.DoesNotExist:
                continue

        if request.data.get("added_medications"):
            for added_item in request.data.get("added_medications") or []:
                name = str(added_item.get("name") or "").strip()
                if not name:
                    continue
                MedicationExtraction.objects.create(
                    prescription=prescription,
                    name=name,
                    generic_name=str(added_item.get("generic_name") or "").strip() or None,
                    dosage=str(added_item.get("dosage") or "").strip() or None,
                    form=str(added_item.get("form") or "").strip() or None,
                    quantity=max(1, int(added_item.get("quantity") or 1)),
                    unit=str(added_item.get("form") or added_item.get("unit") or "comprimés").strip() or "comprimés",
                    posology=str(added_item.get("posology") or "").strip() or None,
                    confidence=float(added_item.get("confidence") or 1.0),
                    confirmed=True,
                    alternatives=[],
                    requires_prescription=True,
                )
                ChatbotLearningData.objects.create(
                    original_text=prescription.ocr_text or "",
                    original_gemini_text=prescription.ocr_text or "",
                    detected_intent="prescription_manual_addition",
                    detected_medicine="",
                    corrected_medicine=name,
                    detected_dosage="",
                    corrected_dosage=str(added_item.get("dosage") or "").strip(),
                    detected_form="",
                    corrected_form=str(added_item.get("form") or "").strip(),
                    detected_posology="",
                    corrected_posology=str(added_item.get("posology") or "").strip(),
                    corrected_answer=f"Le patient a ajouté manuellement {name}.",
                    source="patient",
                    confidence_before=0.0,
                    confidence_after=1.0,
                    prescription=prescription,
                    user=request.user,
                )
                learning_events_created += 1

        # Update prescription status
        all_confirmed = all(
            med.confirmed for med in prescription.extracted_medications.all()
        )

        if all_confirmed and prescription.extracted_medications.exists():
            prescription.status = 'confirmed'
            prescription.notes = "J'ai bien enregistré mes médicaments. Je recherche maintenant les pharmacies disponibles."
            prescription.save()

            # Create status history
            PrescriptionStatusHistory.objects.create(
                prescription=prescription,
                status='confirmed',
                changed_by=request.user,
                notes='All medications confirmed by patient'
            )

            result = PharmiGoChatbotOrchestrator().on_patient_confirmed_medicines(prescription.id, request.user)
            prescription.refresh_from_db()
            pharmacies = result.get("recommendations", [])

            create_targeted_notification(
                title="Ordonnance confirmée",
                message=f"L'ordonnance {prescription.public_reference} a été confirmée avec les médicaments extraits.",
                channel="prescriptions:pharmacy",
            )
            create_targeted_notification(
                title="Recherche de pharmacies lancée",
                message=prescription.notes,
                channel="prescriptions:patient",
                recipient_user=prescription.patient_user,
            )

            serialized = PrescriptionSerializer(prescription, context={"request": request}).data
            serialized["bot_result"] = {
                "is_valid_prescription": True,
                "message": prescription.notes,
                "pharmacies": pharmacies,
                "medications": serialized.get("extracted_medications", []),
                "needs_confirmation": False,
                "raw_text_displayable": False,
                "analysis_source": "analysis",
                "recommendation_status": result.get("status"),
            }
            broadcast_feed_event("prescription.confirmed", serialized)

            return Response({
                **serialized,
                'prescription_id': prescription.id,
                'status': prescription.status,
                'message': prescription.notes,
                'recommendations': pharmacies,
                'pharmacies': pharmacies,
                'medications': serialized.get("extracted_medications", []),
                'learning_events_created': learning_events_created,
            }, status=status.HTTP_200_OK)

        return Response({
            'prescription_id': prescription.id,
            'status': prescription.status,
            'message': 'Medications confirmed successfully',
            'learning_events_created': learning_events_created,
        }, status=status.HTTP_200_OK)


class PrescriptionSearchPharmaciesView(views.APIView):
    """Search pharmacies with available medications"""
    permission_classes = [IsAuthenticated]
    
    def get(self, request, prescription_id):
        try:
            prescription = Prescription.objects.get(id=prescription_id)
        except Prescription.DoesNotExist:
            return Response(
                {'error': 'Prescription not found'},
                status=status.HTTP_404_NOT_FOUND
            )
        if not _can_manage_patient_prescription(request.user, prescription):
            return Response({"error": "Access denied"}, status=status.HTTP_403_FORBIDDEN)

        if not prescription.extracted_medications.filter(confirmed=True).exists():
            return Response(
                {'error': 'No confirmed medications found'},
                status=status.HTTP_400_BAD_REQUEST
            )

        result = PharmiGoChatbotOrchestrator().search_pharmacies_for_prescription(
            prescription.id,
            prescription.patient_user,
        )
        prescription.refresh_from_db()
        pharmacies = result.get("recommendations", [])

        create_targeted_notification(
            title="Recherche de pharmacies lancée",
            message=f"{len(pharmacies)} pharmacie(s) potentielle(s) ont été trouvée(s) pour votre ordonnance.",
            channel="prescriptions:patient",
            recipient_user=prescription.patient_user,
        )
        broadcast_feed_event(
            "prescription.search.completed",
            {
                "prescription_id": prescription.id,
                "status": prescription.status,
                "pharmacies_found": len(pharmacies),
            },
        )

        return Response({
            'prescription_id': prescription.id,
            'status': result.get("status", "ready"),
            'message': result.get("message"),
            'recommendations': pharmacies,
            'pharmacies': pharmacies,
            'total_pharmacies': len(pharmacies)
        }, status=status.HTTP_200_OK)


class PrescriptionRecommendationsView(views.APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request, prescription_id):
        try:
            prescription = Prescription.objects.get(id=prescription_id)
        except Prescription.DoesNotExist:
            return Response({"error": "Prescription not found"}, status=status.HTTP_404_NOT_FOUND)
        if not _can_manage_patient_prescription(request.user, prescription):
            return Response({"error": "Access denied"}, status=status.HTTP_403_FORBIDDEN)

        recommendations = PharmacyRecommendationService().serialize_existing(prescription)
        if recommendations:
            status_value = "ready"
            message = prescription.notes or "J'ai trouvé les pharmacies suivantes qui possèdent mes médicaments."
        elif prescription.status == "confirmed_unavailable":
            status_value = "unavailable"
            message = prescription.notes or "Les médicaments confirmés n'ont pas encore été trouvés dans les stocks du réseau."
        elif prescription.status in {"searching", "confirmed"}:
            status_value = "searching"
            message = prescription.notes or "Je recherche les pharmacies qui possèdent mes médicaments..."
        elif prescription.status == "error":
            status_value = "failed"
            message = prescription.notes or "La recherche des pharmacies a échoué."
        else:
            status_value = "empty"
            message = prescription.notes or "Aucune recommandation n'est disponible pour le moment."

        return Response(
            {
                "prescription_id": prescription.id,
                "status": status_value,
                "message": message,
                "recommendations": recommendations,
            },
            status=status.HTTP_200_OK,
        )


class PrescriptionSelectPharmacyView(views.APIView):
    """Select a pharmacy for the prescription"""
    permission_classes = [IsAuthenticated]
    
    def post(self, request, prescription_id):
        try:
            prescription = Prescription.objects.get(id=prescription_id)
        except Prescription.DoesNotExist:
            return Response(
                {'error': 'Prescription not found'},
                status=status.HTTP_404_NOT_FOUND
            )
        if not _can_manage_patient_prescription(request.user, prescription):
            return Response({"error": "Access denied"}, status=status.HTTP_403_FORBIDDEN)
        
        pharmacy_id = request.data.get('pharmacy_id')
        if not pharmacy_id:
            return Response(
                {'error': 'pharmacy_id is required'},
                status=status.HTTP_400_BAD_REQUEST
            )
        
        try:
            from apps.pharmacies.models import Pharmacy
            pharmacy = Pharmacy.objects.get(id=pharmacy_id)
        except Pharmacy.DoesNotExist:
            return Response(
                {'error': 'Pharmacy not found'},
                status=status.HTTP_404_NOT_FOUND
            )

        if not is_pharmacy_partner_eligible(pharmacy):
            return Response(
                {"error": PAYMENT_WALL_MESSAGE},
                status=status.HTTP_403_FORBIDDEN,
            )

        recommended_pharmacy_ids = set(
            prescription.recommendations.values_list("pharmacy_id", flat=True)
        )
        if recommended_pharmacy_ids and pharmacy.id not in recommended_pharmacy_ids:
            return Response(
                {"error": "Selected pharmacy is not in the authorized recommendation list"},
                status=status.HTTP_400_BAD_REQUEST,
            )
        
        reference = _format_prescription_reference(prescription)
        medications_summary = _build_confirmed_medication_summary(prescription)

        # Update prescription
        prescription.pharmacy = pharmacy
        prescription.status = 'pharmacy_selected'
        prescription.notes = (
            f"{reference} envoyée à {pharmacy.name}. "
            f"Médicaments confirmés: {medications_summary}"
        )
        prescription.save()
        
        # Create status history
        PrescriptionStatusHistory.objects.create(
            prescription=prescription,
            status='pharmacy_selected',
            changed_by=request.user,
            notes=f'Pharmacy {pharmacy.name} selected for {reference}'
        )

        create_targeted_notification(
            title="Pharmacie sélectionnée",
            message=f"{reference} a été envoyée à {pharmacy.name}.",
            channel="prescriptions:patient",
            recipient_user=prescription.patient_user,
        )
        create_targeted_notification(
            title="Nouvelle ordonnance reçue",
            message=(
                f"Ordonnance {reference} attribuée. "
                f"Zone: {prescription.geo_zone or 'Zone non renseignee'}. "
                f"Médicaments confirmés: {medications_summary}. "
                f"Le document original est disponible uniquement dans votre espace PharmiGo autorisé."
            ),
            channel="prescriptions:pharmacy",
            recipient_pharmacy=pharmacy,
        )
        broadcast_feed_event(
            "prescription.pharmacy_selected",
            {
                "prescription_id": prescription.id,
                "public_reference": reference,
                "pharmacy_id": pharmacy.id,
                "pharmacy_name": pharmacy.name,
                "patient_alias": prescription.get_public_patient_alias(),
                "geo_zone": prescription.geo_zone,
                "confirmed_medications": medications_summary,
                "status": prescription.status,
            },
        )
        
        return Response({
            'prescription_id': prescription.id,
            'public_reference': reference,
            'selected_pharmacy': {
                'id': pharmacy.id,
                'name': pharmacy.name,
                'address': pharmacy.address
            },
            'status': prescription.status
        }, status=status.HTTP_200_OK)


class PrescriptionPharmacyConfirmView(views.APIView):
    """Pharmacy confirms prescription is served"""
    permission_classes = [IsAuthenticated]
    
    def post(self, request, prescription_id):
        try:
            prescription = Prescription.objects.get(id=prescription_id)
        except Prescription.DoesNotExist:
            return Response(
                {'error': 'Prescription not found'},
                status=status.HTTP_404_NOT_FOUND
            )
        if not (_is_admin_user(request.user) or _is_selected_pharmacy_user(request.user, prescription)):
            return Response({"error": "Access denied"}, status=status.HTTP_403_FORBIDDEN)
        
        total_amount = request.data.get('total_amount')
        payment_method = request.data.get('payment_method', 'cash')
        notes = request.data.get('notes', '')
        
        # Update prescription
        prescription.status = 'served'
        prescription.total_amount = total_amount
        prescription.served_at = timezone.now()
        prescription.notes = notes
        prescription.save()
        
        # Create status history
        PrescriptionStatusHistory.objects.create(
            prescription=prescription,
            status='served',
            changed_by=request.user,
            notes=f'Served by pharmacy. Total: {total_amount}'
        )

        create_targeted_notification(
            title="Ordonnance servie",
            message="La pharmacie a indiqué que vos médicaments sont prêts ou servis.",
            channel="prescriptions:patient",
            recipient_user=prescription.patient_user,
        )
        if prescription.pharmacy_id:
            create_targeted_notification(
                title="Service enregistré",
                message=f"Le statut servi a été enregistré pour l'ordonnance {prescription.id}.",
                channel="prescriptions:pharmacy",
                recipient_pharmacy=prescription.pharmacy,
            )
        broadcast_feed_event(
            "prescription.served",
            {
                "prescription_id": prescription.id,
                "status": prescription.status,
                "served_at": prescription.served_at.isoformat() if prescription.served_at else None,
            },
        )
        safe_record_activity_for_referral(
            prescription.pharmacy,
            prescription,
            request=request,
            source_label="pharmacy_served",
        )
        
        return Response({
            'prescription_id': prescription.id,
            'status': prescription.status,
            'served_at': prescription.served_at
        }, status=status.HTTP_200_OK)


class PrescriptionPatientConfirmView(views.APIView):
    """Patient confirms they received the medications"""
    permission_classes = [IsAuthenticated]
    
    def post(self, request, prescription_id):
        try:
            prescription = Prescription.objects.get(id=prescription_id)
        except Prescription.DoesNotExist:
            return Response(
                {'error': 'Prescription not found'},
                status=status.HTTP_404_NOT_FOUND
            )
        if not _can_manage_patient_prescription(request.user, prescription):
            return Response({"error": "Access denied"}, status=status.HTTP_403_FORBIDDEN)

        confirmed = request.data.get('confirmed', True)
        issue = request.data.get('issue', '')

        if confirmed:
            prescription.status = 'completed'
            prescription.patient_confirmed_at = timezone.now()
        else:
            prescription.status = 'error'
            prescription.notes = f'Patient issue: {issue}'

        prescription.save()

        # Create status history
        PrescriptionStatusHistory.objects.create(
            prescription=prescription,
            status=prescription.status,
            changed_by=request.user,
            notes=issue if not confirmed else 'Patient confirmed receipt'
        )

        if confirmed:
            create_targeted_notification(
                title="Ordonnance terminée",
                message="Merci, votre ordonnance a bien été classée comme servie.",
                channel="prescriptions:patient",
                recipient_user=prescription.patient_user,
            )
            if prescription.pharmacy_id:
                create_targeted_notification(
                    title="Achat confirmé",
                    message="Le patient a confirmé l'achat des médicaments.",
                    channel="prescriptions:pharmacy",
                    recipient_pharmacy=prescription.pharmacy,
                )
        elif prescription.pharmacy_id:
            create_targeted_notification(
                title="Incident signalé",
                message=f"Le patient a signalé un problème: {issue or 'non précisé'}.",
                channel="prescriptions:pharmacy",
                recipient_pharmacy=prescription.pharmacy,
            )

        broadcast_feed_event(
            "prescription.patient_confirmation",
            {
                "prescription_id": prescription.id,
                "status": prescription.status,
                "confirmed": bool(confirmed),
            },
        )
        if confirmed:
            safe_record_activity_for_referral(
                prescription.pharmacy,
                prescription,
                request=request,
                source_label="patient_confirmed",
            )

        return Response({
            'prescription_id': prescription.id,
            'status': prescription.status
        }, status=status.HTTP_200_OK)


class PrescriptionDocumentAccessView(views.APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request, prescription_id):
        try:
            prescription = Prescription.objects.get(id=prescription_id)
        except Prescription.DoesNotExist:
            return Response({"error": "Prescription not found"}, status=status.HTTP_404_NOT_FOUND)

        if not _can_view_prescription_document(request.user, prescription):
            return Response({"error": "Access denied"}, status=status.HTTP_403_FORBIDDEN)

        document_path = prescription.get_private_document_path()
        if not document_path or not os.path.exists(document_path):
            return Response({"error": "Prescription document unavailable"}, status=status.HTTP_404_NOT_FOUND)

        response = FileResponse(
            open(document_path, "rb"),
            as_attachment=False,
            filename=prescription.get_document_original_name(),
            content_type=prescription.document_content_type or None,
        )
        response["Cache-Control"] = "private, no-store, max-age=0"
        return response


class PharmacyStockListView(generics.ListCreateAPIView):
    """List and create pharmacy stock items"""
    serializer_class = PharmacyStockSerializer
    permission_classes = []
    
    def get_serializer_class(self):
        from .serializers import PharmacyStockSerializer
        return PharmacyStockSerializer
    
    def get_queryset(self):
        user = get_request_user(self.request)
        profile = getattr(user, "profile", None)
        pharmacy = getattr(profile, "pharmacy", None)
        return PharmacyStock.objects.filter(pharmacy=pharmacy) if pharmacy else PharmacyStock.objects.none()
    
    def perform_create(self, serializer):
        user = get_request_user(self.request)
        if user is None:
            raise serializers.ValidationError("Connexion pharmacie requise.")
        profile = getattr(user, "profile", None)
        pharmacy = getattr(profile, "pharmacy", None)
        if pharmacy is None:
            raise serializers.ValidationError("Vous n'avez pas de pharmacie associée.")
        if not pharmacy_subscription_is_active(pharmacy):
            raise serializers.ValidationError("Votre abonnement pharmacie est inactif ou expiré.")
        serializer.save(pharmacy=pharmacy)


class PharmacyStockDetailView(generics.RetrieveUpdateDestroyAPIView):
    """Retrieve, update or delete a pharmacy stock item"""
    serializer_class = PharmacyStockSerializer
    permission_classes = []
    lookup_field = "id"
    lookup_url_kwarg = "id"
    
    def get_serializer_class(self):
        from .serializers import PharmacyStockSerializer
        return PharmacyStockSerializer
    
    def get_queryset(self):
        user = get_request_user(self.request)
        profile = getattr(user, "profile", None)
        pharmacy = getattr(profile, "pharmacy", None)
        return PharmacyStock.objects.filter(pharmacy=pharmacy) if pharmacy else PharmacyStock.objects.none()


class ChatBotQAView(views.APIView):
    """Q&A endpoint for ChatBot to answer questions based on database data"""
    permission_classes = []  # Allow unauthenticated access
    
    def post(self, request):
        question = request.data.get('question', '')
        
        if not question:
            return Response(
                {'error': 'Question is required'},
                status=status.HTTP_400_BAD_REQUEST
            )
        
        qa_service = QAService()
        answer = qa_service.answer_question(question, request.user if request.user.is_authenticated else None)
        
        return Response({
            'question': question,
            'answer': answer
        }, status=status.HTTP_200_OK)
