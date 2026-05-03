from django.db import transaction
from django.utils import timezone
from rest_framework import viewsets
from rest_framework.decorators import action, api_view, permission_classes
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response

from .models import (Pharmacy, Medicine, MedicineSynonym, PharmacyStock, Prescription, PrescriptionItem, PrescriptionHistory, ChatMessage)
from .serializers import (PharmacySerializer, MedicineSerializer, MedicineSynonymSerializer, PharmacyStockSerializer, PrescriptionSerializer)
from .utils import normalize_text
from .ocr_service import OCRService
from .medication_parser import MedicationParser


class PrescriptionAIService:
    def __init__(self):
        self.medicine_db = MedicineDatabase()

    def analyze(self, image_path, fallback_text=''):
        # Process image with OCR
        ocr_text = OCRService.process_image(image_path)
        # Parse medications from OCR text
        medications = MedicationParser.parse_ocr_text(ocr_text)
        # Normalize and match with database
        normalized_meds = self.normalize_medications(medications)
        # Check for confirmation needs
        needs_confirmation = self.check_confirmation_needs(normalized_meds)
        return {
            'raw_text': ocr_text,
            'medicines': normalized_meds,
            'needs_confirmation': needs_confirmation
        }

    def normalize_medications(self, medications):
        normalized = []
        for med in medications:
            normalized_med = MedicineDatabase.normalize_medication(med.name)
            # Fuzzy match with database
            matched_med = self.medicine_db.find_closest_match(normalized_med)
            if matched_med:
                normalized.append({
                    "name": med.name,
                    "normalized_name": matched_med.normalized_name,
                    "dosage": med.dosage,
                    "form": med.unit,
                    "quantity": med.quantity,
                    "confidence": med.confidence,
                    "generic_name": matched_med.generic_name,
                    "category": matched_med.category
                })
            else:
                # Create new Medicine if not found
                normalized.append({
                    "name": med.name,
                    "normalized_name": normalized_med,
                    "dosage": med.dosage,
                    "form": med.unit,
                    "quantity": med.quantity,
                    "confidence": med.confidence,
                    "generic_name": '',
                    "category": ''
                })
        return normalized

    def check_confirmation_needs(self, medications):
        # Check if any medications have low confidence or need verification
        return any(med.get('confidence', 0) < 0.8 for med in medications)


class PharmacyMatchingService:
    def __init__(self):
        self.stock_db = MedicineDatabase()

    def match(self, prescription):
        # Get all medicines from prescription
        medicines = prescription.items.all()
        # Find pharmacies with all required medicines
        pharmacies = set()
        for med in medicines:
            # Find pharmacies with this medicine
            stock_pharmacies = set(PharmacyStock.objects.filter(
                medicine__normalized_name=med.normalized_name,
                quantity__gt=0
            ).values_list('pharmacy_id', flat=True))
            if not pharmacies:
                pharmacies = stock_pharmacies
            else:
                pharmacies &= stock_pharmacies
        # Return list of matching pharmacies
        return list(pharmacies)


class MedicineDatabase:
    @staticmethod
    def populate_database():
        # Implementation for populating medicine database
        return 1000  # Example count

    @staticmethod
    def normalize_medication(name):
        # Implement normalization logic
        return name.lower().strip()

    def find_closest_match(self, normalized_name):
        # Implement fuzzy matching logic
        return Medicine.objects.filter(normalized_name=normalized_name).first()