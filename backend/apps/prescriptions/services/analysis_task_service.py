from concurrent.futures import ThreadPoolExecutor
import logging

from django.conf import settings
from django.db import close_old_connections
from django.utils import timezone

from apps.prescriptions.models import AnalysisLog, MedicationExtraction, Prescription, PrescriptionAnalysisTask, PrescriptionStatusHistory
from apps.prescriptions.serializers import PrescriptionSerializer
from apps.prescriptions.services.pharmacy_recommendation_service import PharmacyRecommendationService
from apps.pharmigo_chatbot.orchestrator import PharmiGoChatbotOrchestrator

from .json_utils import ensure_json_serializable
from .prescription_analysis_service import PrescriptionAnalysisService

_executor = ThreadPoolExecutor(max_workers=2)
logger = logging.getLogger(__name__)


class AnalysisTaskService:
    """Queue and process prescription analysis tasks."""

    def enqueue(self, task_id):
        _executor.submit(self._process_task, str(task_id))

    def _process_task(self, task_id: str):
        close_old_connections()
        try:
            task = PrescriptionAnalysisTask.objects.select_related("prescription", "prescription__patient_user").get(task_id=task_id)
        except PrescriptionAnalysisTask.DoesNotExist:
            close_old_connections()
            return

        prescription = task.prescription
        self._log(task, prescription, "task", "info", "Analyse de l'ordonnance demarree.")
        logger.info("[ANALYSIS] task_start task_id=%s prescription_id=%s", task_id, prescription.id)
        task.status = "processing"
        task.save(update_fields=["status", "updated_at"])
        prescription.status = "analyzing"
        prescription.save(update_fields=["status", "updated_at"])

        image_path = prescription.get_private_document_path()
        self._log(
            task,
            prescription,
            "upload",
            "info",
            "[UPLOAD] private document prepared for analysis.",
            {
                "prescription_id": prescription.id,
                "has_document": bool(image_path),
            },
        )

        try:
            result = PrescriptionAnalysisService().analyze_prescription(
                image_path=image_path,
                text_input=prescription.ocr_text or "",
            )
            try:
                result = ensure_json_serializable(result)
            except Exception as exc:
                raise RuntimeError(f"Serialization error: {exc}") from exc
            payload = result["data"]
            analysis = payload["analysis"]
            task.raw_ocr_text = str(result["ocr"].get("text") or "")
            task.raw_gemini_text = str(result["gemini"].get("text") or "")
            task.ocr_payload = ensure_json_serializable(result["ocr"])
            task.gemini_payload = ensure_json_serializable(result["gemini"])
            task.analysis_payload = ensure_json_serializable(analysis)
            task.global_score = payload["global_score"]
            task.needs_confirmation = payload["needs_confirmation"]
            logger.info(
                "[ANALYSIS] task_id=%s gemini_success=%s gemini_error=%s raw_gemini_text_length=%s extracted_count=%s global_score=%s needs_confirmation=%s",
                task_id,
                result.get("gemini", {}).get("success"),
                result.get("gemini", {}).get("error"),
                len(task.raw_gemini_text),
                len(analysis),
                task.global_score,
                task.needs_confirmation,
            )

            prescription.extracted_medications.all().delete()
            for item in analysis:
                MedicationExtraction.objects.create(
                    prescription=prescription,
                    name=item["corrected_name"],
                    generic_name=item.get("generic_name"),
                    dosage=item.get("dosage"),
                    form=item.get("form"),
                    quantity=item.get("quantity") or 1,
                    unit=item.get("unit") or item.get("form") or "comprimés",
                    posology=item.get("posology"),
                    confidence=item.get("confidence") or 0.0,
                    confirmed=not payload["needs_confirmation"] and payload["global_score"] > 0.9,
                    alternatives=[],
                    requires_prescription=True,
                )

            display_text = result.get("raw_text") or ""
            display_text_source = result.get("raw_text_source")
            prescription.ocr_text = display_text if display_text_source in {"gemini", "analysis"} else ""
            prescription.confidence_score = payload["global_score"]
            prescription.notes = result["message"]
            if payload["needs_confirmation"]:
                prescription.status = "confirmation_pending"
                task.status = "needs_confirmation"
                if result.get("gemini", {}).get("success") and (task.raw_gemini_text or task.analysis_payload):
                    prescription.notes = "J'ai extrait du texte, mais je dois confirmer les médicaments."
                PharmiGoChatbotOrchestrator().on_medicines_detected(prescription.id)
            else:
                PharmiGoChatbotOrchestrator().search_pharmacies_for_prescription(
                    prescription.id,
                    prescription.patient_user,
                )
                prescription.refresh_from_db(fields=["status", "notes"])
                task.status = "completed"
            prescription.save(update_fields=["ocr_text", "confidence_score", "notes", "status", "updated_at"])
            task.completed_at = timezone.now()
            task.save(
                update_fields=[
                    "raw_ocr_text",
                    "raw_gemini_text",
                    "ocr_payload",
                    "gemini_payload",
                    "analysis_payload",
                    "global_score",
                    "needs_confirmation",
                    "status",
                    "completed_at",
                    "updated_at",
                ]
            )

            PrescriptionStatusHistory.objects.create(
                prescription=prescription,
                status=prescription.status,
                changed_by=prescription.patient_user,
                notes="Analyse hybride OCR + Gemini terminee.",
            )
            self._log(
                task,
                prescription,
                "analysis",
                "info",
                "[ANALYSIS] Analyse terminee.",
                ensure_json_serializable({
                    "global_score": payload["global_score"],
                    "needs_confirmation": payload["needs_confirmation"],
                    "items": analysis,
                    "gemini_response_time_ms": result.get("gemini", {}).get("response_time_ms"),
                    "gemini_success": result.get("gemini", {}).get("success"),
                    "gemini_error": result.get("gemini", {}).get("error"),
                    "image_sent_to_gemini": result.get("gemini", {}).get("image_sent"),
                    "raw_gemini_text": task.raw_gemini_text[:1000] if task.raw_gemini_text else "",
                    "gemini_payload": result.get("gemini", {}),
                    "analysis_payload_count": len(analysis),
                    "raw_text_source": display_text_source,
                }),
            )
            logger.info("[ANALYSIS] final status=%s task_status=%s", prescription.status, task.status)
        except Exception as exc:
            logger.exception("[ANALYSIS] exception task_id=%s prescription_id=%s", task_id, prescription.id)
            task.status = "failed"
            task.error_message = str(exc)
            task.needs_confirmation = False
            task.completed_at = timezone.now()
            task.save(update_fields=["status", "needs_confirmation", "error_message", "completed_at", "updated_at"])
            prescription.status = "error"
            technical_message = str(exc).strip()
            prescription.notes = "L'analyse automatique a echoue. Cette ordonnance a ete rejetee. Merci de televerser une image plus lisible."
            if technical_message and settings.DEBUG:
                prescription.notes = f"{prescription.notes} Detail technique: {technical_message[:300]}"
            prescription.save(update_fields=["status", "notes", "updated_at"])
            self._log(task, prescription, "analysis", "warning", "[ANALYSIS] Analyse rejetee, reupload requis.", {"error": str(exc)})
        finally:
            close_old_connections()

    def serialize_task(self, task: PrescriptionAnalysisTask, request=None) -> dict:
        prescription = task.prescription
        serialized = PrescriptionSerializer(prescription, context={"request": request} if request else {}).data
        pharmacies = []
        if prescription.status in {"searching", "pharmacy_selected", "preparing", "ready", "served", "completed"}:
            pharmacies = PharmacyRecommendationService().serialize_existing(prescription)
        medications = [
            {
                "id": med.get("id"),
                "name": med.get("name"),
                "detected_name": med.get("name"),
                "corrected_name": med.get("name"),
                "generic_name": med.get("generic_name"),
                "dosage": med.get("dosage"),
                "form": med.get("form"),
                "quantity": med.get("quantity"),
                "unit": med.get("unit"),
                "posology": med.get("posology"),
                "confidence": med.get("confidence"),
                "needs_review": not med.get("confirmed", False),
            }
            for med in serialized.get("extracted_medications", [])
        ]
        debug_info = None
        if settings.DEBUG:
            debug_info = {
                "analysis_status": task.status,
                "raw_gemini_text_length": len(task.raw_gemini_text or ""),
                "gemini_error": task.gemini_payload.get("error") if isinstance(task.gemini_payload, dict) else None,
                "extracted_count": len(task.analysis_payload or []),
                "has_document": bool(prescription.get_private_document_path()),
                "gemini_success": task.gemini_payload.get("success") if isinstance(task.gemini_payload, dict) else None,
            }

        if task.status == "failed":
            return {
                "status": "error",
                "task_id": str(task.task_id),
                "prescription_id": prescription.id,
                "task_status": task.status,
                "debug": debug_info,
                "data": {
                    "analysis": [],
                    "global_score": task.global_score,
                    "needs_confirmation": False,
                },
                "record": None,
                "error": prescription.notes or task.error_message or "Analyse impossible.",
            }

        return {
            "status": "success",
            "task_id": str(task.task_id),
            "prescription_id": prescription.id,
            "task_status": task.status,
            "debug": debug_info,
            "data": {
                "prescription_id": str(task.task_id),
                "analysis": [
                    {
                        "detected_name": item.get("detected_name") or item.get("name"),
                        "corrected_name": item.get("corrected_name") or item.get("name"),
                        "dosage": item.get("dosage"),
                        "confidence": item.get("confidence"),
                    }
                    for item in task.analysis_payload
                ],
                "global_score": task.global_score,
                "needs_confirmation": task.needs_confirmation,
            },
            "record": {
                **serialized,
                "bot_result": {
                    "is_valid_prescription": True,
                    "message": prescription.notes or "Analyse terminee.",
                    "pharmacies": pharmacies,
                    "medications": medications,
                    "needs_confirmation": task.needs_confirmation,
                    "raw_text_displayable": bool(task.raw_gemini_text or task.analysis_payload),
                    "analysis_source": "gemini" if task.raw_gemini_text else ("analysis" if task.analysis_payload else "manual"),
                    "technical_error": task.error_message if settings.DEBUG else None,
                    "debug": debug_info,
                },
                "ocr_text": prescription.ocr_text,
                "confidence_score": prescription.confidence_score,
            },
            "error": task.error_message,
        }

    def _log(self, task, prescription, stage, level, message, payload=None):
        safe_payload = ensure_json_serializable(payload or {})
        AnalysisLog.objects.create(
            task=task,
            prescription=prescription,
            stage=stage,
            level=level,
            message=message,
            payload=safe_payload,
        )
