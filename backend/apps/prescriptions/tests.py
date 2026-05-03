from django.contrib.auth import get_user_model
from django.core.files.base import ContentFile
from django.core.files.uploadedfile import SimpleUploadedFile
from rest_framework.test import APITestCase
from unittest.mock import patch

from apps.prescriptions.models import PharmacyStock, Prescription
from apps.common.storage import private_prescription_storage
from apps.prescriptions.services.analysis_task_service import AnalysisTaskService
from apps.prescriptions.services.json_utils import ensure_json_serializable
from apps.pharmacies.models import Pharmacy
from apps.users.models import UserProfile

User = get_user_model()


class PrescriptionUploadApiTests(APITestCase):
    def setUp(self):
        self.user = User.objects.create_user(username="patient-one", password="secret123")
        UserProfile.objects.create(user=self.user, role="patient", phone_number="+25761000001")
        self.client.force_authenticate(user=self.user)

    def test_upload_with_text_only_succeeds_and_does_not_raise_500(self):
        with patch("apps.prescriptions.views.AnalysisTaskService.enqueue"):
            response = self.client.post(
                "/api/upload-prescription/",
                {
                    "analysis_text": "Amoxicilline 500mg 2 boites",
                    "patient_name": "Patient One",
                    "patient_email": "patient@example.com",
                },
                format="multipart",
            )

        self.assertEqual(response.status_code, 202)
        self.assertIn("task_id", response.data)
        self.assertIn("prescription_id", response.data)
        self.assertTrue(Prescription.objects.filter(id=response.data["prescription_id"]).exists())

    def test_upload_without_file_or_text_returns_400(self):
        response = self.client.post("/api/upload-prescription/", {}, format="multipart")

        self.assertEqual(response.status_code, 400)
        self.assertIn("error", response.data)

    @patch("apps.prescriptions.services.gemini_vision_service.GeminiVisionService.analyze_prescription")
    @patch("apps.prescriptions.services.ocr_service.OCRService.analyze_with_both_engines")
    def test_task_status_returns_analysis_candidates(self, mock_ocr, mock_gemini):
        mock_ocr.return_value = {
            "success": True,
            "text": "Cefixime 200mg 1 boite",
            "confidence": 0.66,
        }
        mock_gemini.return_value = {
            "success": True,
            "text": "Cefixime 200mg voie orale",
            "confidence": 0.82,
            "medications": [
                {"name": "Cefixime", "dosage": "200mg", "form": "boite", "posology": "1 par jour", "confidence": 0.82}
            ],
        }
        uploaded = SimpleUploadedFile("ordonnance.png", b"fake-image-content", content_type="image/png")

        with patch("apps.prescriptions.views.AnalysisTaskService.enqueue"):
            upload_response = self.client.post(
                "/api/upload-prescription/",
                {
                    "prescription_image": uploaded,
                    "patient_name": "Patient One",
                    "patient_email": "patient@example.com",
                },
                format="multipart",
            )

        AnalysisTaskService()._process_task(upload_response.data["task_id"])
        status_response = self.client.get(f"/api/prescription-analysis/{upload_response.data['task_id']}/")

        self.assertEqual(upload_response.status_code, 202)
        self.assertEqual(status_response.status_code, 200)
        self.assertTrue(status_response.data["record"]["bot_result"]["medications"])
        self.assertIn("Cefixime", status_response.data["record"]["ocr_text"])
        self.assertEqual(status_response.data["record"]["bot_result"]["analysis_source"], "gemini")
        self.assertTrue(status_response.data["record"]["bot_result"]["raw_text_displayable"])

    @patch("apps.prescriptions.services.gemini_vision_service.GeminiVisionService.analyze_prescription")
    @patch("apps.prescriptions.services.ocr_service.OCRService.analyze_with_both_engines")
    def test_gemini_failure_hides_illisible_ocr_text_from_primary_result(self, mock_ocr, mock_gemini):
        mock_ocr.return_value = {
            "success": True,
            "text": "CENTES MASNICEL ROPLS CO CANTEX",
            "confidence": 0.25,
        }
        mock_gemini.return_value = {
            "success": False,
            "error": "Gemini HTTP error: 403",
            "text": "",
            "confidence": 0.0,
            "medications": [],
            "response_time_ms": 1900,
            "image_sent": True,
        }
        uploaded = SimpleUploadedFile("ordonnance.png", b"fake-image-content", content_type="image/png")

        with patch("apps.prescriptions.views.AnalysisTaskService.enqueue"):
            upload_response = self.client.post(
                "/api/upload-prescription/",
                {
                    "prescription_image": uploaded,
                    "patient_name": "Patient One",
                    "patient_email": "patient@example.com",
                },
                format="multipart",
            )

        AnalysisTaskService()._process_task(upload_response.data["task_id"])
        status_response = self.client.get(f"/api/prescription-analysis/{upload_response.data['task_id']}/")

        self.assertEqual(status_response.status_code, 200)
        self.assertEqual(status_response.data["record"]["ocr_text"], "")
        self.assertEqual(status_response.data["record"]["bot_result"]["analysis_source"], "manual")
        self.assertFalse(status_response.data["record"]["bot_result"]["raw_text_displayable"])
        self.assertIn("Je n'ai pas pu analyser correctement", status_response.data["record"]["bot_result"]["message"])

    @patch("apps.prescriptions.services.gemini_vision_service.GeminiVisionService.analyze_prescription")
    @patch("apps.prescriptions.services.ocr_service.OCRService.analyze_with_both_engines")
    def test_confirming_medications_triggers_pharmacy_search(self, mock_ocr, mock_gemini):
        mock_ocr.return_value = {
            "success": True,
            "text": "Amoxicilline 500mg 1 boite",
            "confidence": 0.58,
        }
        mock_gemini.return_value = {
            "success": True,
            "text": "Amoxicilline 500mg",
            "confidence": 0.95,
            "medications": [
                {"name": "Amoxiciline", "dosage": "500mg", "form": "boite", "posology": "1 par jour", "confidence": 0.95}
            ],
        }
        pharmacy = Pharmacy.objects.create(
            name="Pharmacie Test",
            city="Bujumbura",
            address="Bujumbura",
            phone_number="+25762000001",
            email="pharmacie@example.com",
        )
        PharmacyStock.objects.create(
            pharmacy=pharmacy,
            medication_name="Amoxicilline",
            dosage="500mg",
            quantity=10,
            unit="boites",
            price=1200,
            is_available=True,
        )
        uploaded = SimpleUploadedFile("ordonnance.png", b"fake-image-content", content_type="image/png")

        with patch("apps.prescriptions.views.AnalysisTaskService.enqueue"):
            upload_response = self.client.post(
                "/api/upload-prescription/",
                {
                    "prescription_image": uploaded,
                    "patient_name": "Patient One",
                    "patient_email": "patient@example.com",
                },
                format="multipart",
            )

        AnalysisTaskService()._process_task(upload_response.data["task_id"])
        task_status_response = self.client.get(f"/api/prescription-analysis/{upload_response.data['task_id']}/")
        medications = task_status_response.data["record"]["bot_result"]["medications"]

        confirm_response = self.client.post(
            "/api/confirm-prescription/",
            {
                "prescription_id": upload_response.data["prescription_id"],
                "medications": [
                    {
                        "id": medications[0]["id"],
                        "confirmed": True,
                        "corrected_name": medications[0]["name"],
                    }
                ],
            },
            format="json",
        )

        self.assertEqual(confirm_response.status_code, 200)
        self.assertEqual(confirm_response.data["status"], "searching")
        self.assertTrue(confirm_response.data["pharmacies"])

    def test_clean_for_json_breaks_circular_references(self):
        payload = {"name": "root"}
        payload["self"] = payload

        cleaned = ensure_json_serializable(payload)

        self.assertEqual(cleaned["name"], "root")
        self.assertEqual(cleaned["self"], "[circular-reference]")

    @patch("apps.prescriptions.services.gemini_vision_service.GeminiVisionService.analyze_prescription")
    @patch("apps.prescriptions.services.ocr_service.OCRService.analyze_with_both_engines")
    def test_task_processing_survives_circular_ocr_payload(self, mock_ocr, mock_gemini):
        circular = {"engine": "google"}
        circular["self"] = circular
        mock_ocr.return_value = {
            "success": True,
            "text": "Amoxicilline 500mg 1 boite",
            "confidence": 0.7,
            "raw_response": circular,
            "all_results": {"google_vision": circular},
        }
        mock_gemini.return_value = {
            "success": False,
            "error": "Gemini unavailable",
            "text": "",
            "confidence": 0.0,
            "medications": [],
        }
        uploaded = SimpleUploadedFile("ordonnance.png", b"fake-image-content", content_type="image/png")

        with patch("apps.prescriptions.views.AnalysisTaskService.enqueue"):
            upload_response = self.client.post(
                "/api/upload-prescription/",
                {
                    "prescription_image": uploaded,
                    "patient_name": "Patient One",
                    "patient_email": "patient@example.com",
                },
                format="multipart",
            )

        AnalysisTaskService()._process_task(upload_response.data["task_id"])
        status_response = self.client.get(f"/api/prescription-analysis/{upload_response.data['task_id']}/")

        self.assertEqual(status_response.status_code, 200)
        self.assertNotIn("Circular reference detected", status_response.data["record"]["bot_result"]["message"])


class PrescriptionSecurityApiTests(APITestCase):
    def setUp(self):
        self.patient = User.objects.create_user(username="patient-secure", password="secret123", email="patient.secure@example.com")
        UserProfile.objects.create(user=self.patient, role="patient", phone_number="+25761001001", address="Rohero, Bujumbura")

        self.other_patient = User.objects.create_user(username="patient-other", password="secret123", email="other@example.com")
        UserProfile.objects.create(user=self.other_patient, role="patient", phone_number="+25761001002", address="Kinindo, Bujumbura")

        self.pharmacy = Pharmacy.objects.create(
            name="Pharmacie Secure",
            city="Bujumbura",
            address="Rohero, Bujumbura",
            phone_number="+25762001001",
            email="secure@example.com",
        )
        self.selected_pharmacy_user = User.objects.create_user(username="pharmacy-secure", password="secret123")
        UserProfile.objects.create(
            user=self.selected_pharmacy_user,
            role="pharmacy",
            phone_number="+25762001002",
            pharmacy=self.pharmacy,
        )

        self.other_pharmacy = Pharmacy.objects.create(
            name="Pharmacie Autre",
            city="Bujumbura",
            address="Kinindo, Bujumbura",
            phone_number="+25762001003",
            email="other-pharmacy@example.com",
        )
        self.other_pharmacy_user = User.objects.create_user(username="pharmacy-other", password="secret123")
        UserProfile.objects.create(
            user=self.other_pharmacy_user,
            role="pharmacy",
            phone_number="+25762001004",
            pharmacy=self.other_pharmacy,
        )

        document_name = private_prescription_storage.save(
            "prescriptions/test-secure-document.txt",
            ContentFile(b"ordonnance privee"),
        )
        self.addCleanup(lambda: private_prescription_storage.delete(document_name))

        self.prescription = Prescription.objects.create(
            patient_name="Patient Secure",
            patient_email="patient.secure@example.com",
            patient_user=self.patient,
            medication_name="Amoxicilline",
            dosage="500mg",
            instructions="Prendre pendant 5 jours",
            ocr_text="Texte OCR confidentiel",
            confidence_score=0.93,
            status="pharmacy_selected",
            pharmacy=self.pharmacy,
            geo_zone="Bujumbura",
            private_document_name=document_name,
            private_document_original_name="ordonnance.txt",
            document_content_type="text/plain",
        )
        self.prescription.comments.create(user=self.patient, body="Commentaire prive")
        self.prescription.responses.create(
            pharmacy=self.pharmacy,
            responder_name=self.pharmacy.name,
            availability_note="Disponible",
            estimated_minutes=20,
            total_price="15000",
            status="quoted",
        )
        self.prescription.extracted_medications.create(
            name="Amoxicilline",
            dosage="500mg",
            quantity=1,
            unit="boite",
            confidence=0.97,
            confirmed=True,
        )
        self.prescription.extracted_medications.create(
            name="Medicament Cache",
            dosage="10mg",
            quantity=1,
            unit="boite",
            confidence=0.42,
            confirmed=False,
        )

    def test_patient_detail_view_is_limited_to_owner(self):
        self.client.force_authenticate(user=self.patient)
        response = self.client.get(f"/api/prescriptions/{self.prescription.id}/")
        self.assertEqual(response.status_code, 200)

        self.client.force_authenticate(user=self.other_patient)
        forbidden_response = self.client.get(f"/api/prescriptions/{self.prescription.id}/")
        self.assertEqual(forbidden_response.status_code, 404)

    def test_pharmacy_list_masks_sensitive_patient_data(self):
        self.client.force_authenticate(user=self.other_pharmacy_user)
        response = self.client.get("/api/prescriptions/")

        self.assertEqual(response.status_code, 200)
        self.assertEqual(len(response.data), 1)
        record = response.data[0]
        self.assertNotEqual(record["patient_name"], self.prescription.patient_name)
        self.assertEqual(record["patient_email"], "")
        self.assertEqual(record["ocr_text"], "")
        self.assertEqual(record["instructions"], "")
        self.assertEqual(record["comments"], [])
        self.assertEqual(record["responses"], [])
        self.assertEqual(record["geo_zone"], "Bujumbura")
        self.assertFalse(record["document_access_granted"])
        self.assertIsNone(record["document_access_url"])
        self.assertEqual(len(record["extracted_medications"]), 1)
        self.assertEqual(record["extracted_medications"][0]["name"], "Amoxicilline")

    def test_document_access_is_restricted_to_owner_and_selected_pharmacy(self):
        document_url = f"/api/prescriptions/{self.prescription.id}/document/"

        self.client.force_authenticate(user=self.other_pharmacy_user)
        forbidden_response = self.client.get(document_url)
        self.assertEqual(forbidden_response.status_code, 403)

        self.client.force_authenticate(user=self.selected_pharmacy_user)
        allowed_response = self.client.get(document_url)
        self.assertEqual(allowed_response.status_code, 200)
        self.assertEqual(allowed_response["Cache-Control"], "private, no-store, max-age=0")

        self.client.force_authenticate(user=self.patient)
        owner_response = self.client.get(document_url)
        self.assertEqual(owner_response.status_code, 200)
