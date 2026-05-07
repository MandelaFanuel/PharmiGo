import json
import logging
import re
import time
from difflib import SequenceMatcher
from math import atan2, cos, radians, sin, sqrt
from typing import Any, Dict, List, Optional, Tuple
from urllib import error, request

try:
    import cv2
except ImportError:  # pragma: no cover - environment dependent
    cv2 = None

try:
    import numpy as np
except ImportError:  # pragma: no cover - environment dependent
    np = None

try:
    import pytesseract
except ImportError:  # pragma: no cover - environment dependent
    pytesseract = None

from django.conf import settings
from django.db.models import Q
from django.utils import timezone

try:
    from fuzzywuzzy import fuzz
except ImportError:  # pragma: no cover - environment dependent
    fuzz = None

from .models import Pharmacy, PharmacyStock, Medicine, MedicineSynonym
from .utils import normalize_text

logger = logging.getLogger(__name__)


class ImagePreprocessor:
    """Prétraitement d'image pour améliorer la reconnaissance OCR"""

    @staticmethod
    def preprocess(image_path: str) -> Any:
        """Applique des transformations pour améliorer la lisibilité"""
        if cv2 is None:
            return None
        # Lire l'image
        img = cv2.imread(image_path)
        if img is None:
            return None

        # Convertir en niveaux de gris
        gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)

        # Appliquer un filtre de débruitage
        denoised = cv2.fastNlMeansDenoising(gray, h=30)

        # Améliorer le contraste avec CLAHE
        clahe = cv2.createCLAHE(clipLimit=3.0, tileGridSize=(8, 8))
        enhanced = clahe.apply(denoised)

        # Seuillage adaptatif
        binary = cv2.adaptiveThreshold(
            enhanced, 255, cv2.ADAPTIVE_THRESH_GAUSSIAN_C, cv2.THRESH_BINARY, 11, 2
        )

        return binary


class MedicineDatabase:
    """Gestion de la base de données des médicaments"""

    # Liste des médicaments courants en RDC et Burundi
    COMMON_MEDICINES = [
        # Antalgiques et antipyrétiques
        {"name": "Paracétamol", "dosage": "500mg", "form": "comprimé", "category": "antalgique"},
        {"name": "Paracétamol", "dosage": "1000mg", "form": "comprimé", "category": "antalgique"},
        {"name": "Paracétamol", "dosage": "250mg/5ml", "form": "sirop", "category": "antalgique"},
        {"name": "Ibuprofène", "dosage": "400mg", "form": "comprimé", "category": "anti-inflammatoire"},
        {"name": "Ibuprofène", "dosage": "600mg", "form": "comprimé", "category": "anti-inflammatoire"},

        # Antibiotiques
        {"name": "Amoxicilline", "dosage": "500mg", "form": "gélule", "category": "antibiotique"},
        {"name": "Amoxicilline", "dosage": "1g", "form": "comprimé", "category": "antibiotique"},
        {"name": "Amoxicilline", "dosage": "250mg/5ml", "form": "suspension", "category": "antibiotique"},
        {"name": "Azithromycine", "dosage": "500mg", "form": "comprimé", "category": "antibiotique"},
        {"name": "Ciprofloxacine", "dosage": "500mg", "form": "comprimé", "category": "antibiotique"},
        {"name": "Métronidazole", "dosage": "500mg", "form": "comprimé", "category": "antibiotique"},
        {"name": "Doxycycline", "dosage": "100mg", "form": "gélule", "category": "antibiotique"},

        # Antipaludéens
        {"name": "Artéméther-Luméfantrine", "dosage": "80mg/480mg", "form": "comprimé", "category": "antipaludéen"},
        {"name": "Chloroquine", "dosage": "100mg", "form": "comprimé", "category": "antipaludéen"},
        {"name": "Quinine", "dosage": "500mg", "form": "comprimé", "category": "antipaludéen"},

        # Antihypertenseurs
        {"name": "Amlodipine", "dosage": "5mg", "form": "comprimé", "category": "antihypertenseur"},
        {"name": "Amlodipine", "dosage": "10mg", "form": "comprimé", "category": "antihypertenseur"},
        {"name": "Losartan", "dosage": "50mg", "form": "comprimé", "category": "antihypertenseur"},
        {"name": "Enalapril", "dosage": "10mg", "form": "comprimé", "category": "antihypertenseur"},

        # Antidiabétiques
        {"name": "Metformine", "dosage": "500mg", "form": "comprimé", "category": "antidiabétique"},
        {"name": "Metformine", "dosage": "850mg", "form": "comprimé", "category": "antidiabétique"},
        {"name": "Glibenclamide", "dosage": "5mg", "form": "comprimé", "category": "antidiabétique"},

        # Gastro-entérologie
        {"name": "Oméprazole", "dosage": "20mg", "form": "gélule", "category": "gastro-entérologie"},
        {"name": "Pantoprazole", "dosage": "40mg", "form": "comprimé", "category": "gastro-entérologie"},
        {"name": "Domperidone", "dosage": "10mg", "form": "comprimé", "category": "gastro-entérologie"},

        # Vitamines et suppléments
        {"name": "Vitamine C", "dosage": "500mg", "form": "comprimé", "category": "vitamine"},
        {"name": "Fer", "dosage": "60mg", "form": "comprimé", "category": "supplément"},
        {"name": "Acide Folique", "dosage": "5mg", "form": "comprimé", "category": "vitamine"},

        # Antihistaminiques
        {"name": "Cétirizine", "dosage": "10mg", "form": "comprimé", "category": "antihistaminique"},
        {"name": "Loratadine", "dosage": "10mg", "form": "comprimé", "category": "antihistaminique"},

        # Corticostéroïdes
        {"name": "Prednisone", "dosage": "20mg", "form": "comprimé", "category": "corticostéroïde"},
        {"name": "Dexaméthasone", "dosage": "4mg", "form": "comprimé", "category": "corticostéroïde"},
    ]

    # Synonymes courants
    SYNONYMS = {
        "Paracétamol": ["Doliprane", "Efferalgan", "Dafalgan", "Paracetamol"],
        "Ibuprofène": ["Advil", "Nurofen", "Spedifen", "Ibuprofen"],
        "Amoxicilline": ["Augmentin", "Clamoxyl", "Amoxil", "Amoxicillin"],
        "Oméprazole": ["Mopral", "Inexium", "Omeprazole"],
        "Metformine": ["Glucophage", "Metformine", "Metformin"],
        "Cétirizine": ["Zyrtec", "Cetirizine", "Virlix"],
        "Prednisone": ["Cortancyl", "Prednisone"],
    }

    @classmethod
    def populate_database(cls):
        """Peupler la base de données avec les médicaments courants"""
        from .utils import normalize_text

        for med_info in cls.COMMON_MEDICINES:
            medicine, created = Medicine.objects.get_or_create(
                name=med_info["name"],
                dosage=med_info["dosage"],
                form=med_info["form"],
                defaults={
                    "normalized_name": normalize_text(f"{med_info['name']} {med_info['dosage']}"),
                    "category": med_info["category"],
                    "is_active": True,
                }
            )

            # Ajouter les synonymes
            for base_name, synonyms in cls.SYNONYMS.items():
                if base_name.lower() == med_info["name"].lower():
                    for synonym in synonyms:
                        MedicineSynonym.objects.get_or_create(
                            medicine=medicine,
                            synonym=synonym,
                            defaults={
                                "normalized_synonym": normalize_text(synonym),
                                "is_brand_name": True,
                            }
                        )

        return Medicine.objects.count()


class PrescriptionAIService:
    """Service d'analyse d'ordonnances avec OCR intelligent"""

    def __init__(self):
        self.preprocessor = ImagePreprocessor()
        self.medicine_db = MedicineDatabase()

    def read_image_text(self, image_path: str) -> str:
        """Extrait le texte d'une image d'ordonnance"""
        try:
            if pytesseract is None:
                return ""
            # Prétraiter l'image
            processed_img = self.preprocessor.preprocess(image_path)
            if processed_img is None:
                return ""

            # Configuration Tesseract optimisée pour le français
            custom_config = r'--oem 3 --psm 6 -l fra+eng'

            # Extraction OCR
            text = pytesseract.image_to_string(processed_img, config=custom_config)

            return text.strip()
        except Exception as e:
            print(f"Erreur OCR: {e}")
            return ""

    def extract_medicines_from_text(self, text: str) -> List[Dict]:
        """Extrait les médicaments du texte OCR"""
        medicines = []
        lines = [line.strip() for line in text.splitlines() if line.strip()]

        # Patterns pour identifier les médicaments
        medicine_patterns = [
            # Nom + dosage (ex: Paracétamol 500mg)
            r'([A-Z][a-zA-Zéèêëàâäùûüôöîïç]+\s*(?:\d+\s*(?:mg|g|ml|mcg|ui|%)?))',
            # Dosage seul (ex: 500mg)
            r'(\d+\s?(mg|g|ml|mcg|ui|%))',
            # Forme pharmaceutique
            r'(comprimé|gélule|sirop|suspension|injection|crème|pommade|collyre)',
        ]

        for line in lines:
            # Nettoyer la ligne
            line = line.strip()
            if len(line) < 3:
                continue

            # Extraire le dosage
            dosage_match = re.search(r'(\d+\s?(mg|g|ml|mcg|ui|%))', line, re.I)
            dosage = dosage_match.group(1).replace(' ', '') if dosage_match else ""

            # Extraire la forme pharmaceutique
            form_match = re.search(r'(comprimé|gélule|sirop|suspension|injection|crème|pommade|collyre)', line, re.I)
            form = form_match.group(1) if form_match else ""

            # Extraire le nom du médicament
            name = line
            if dosage:
                name = line.split(dosage)[0].strip()
            name = re.sub(r'^[\-\d\.\) ]+', '', name).strip()
            name = re.sub(r'\s*\(.*?\)\s*', '', name).strip()  # Enlever les parenthèses

            # Nettoyer le nom
            name = re.sub(r'[^\w\séèêëàâäùûüôöîïç-]', '', name).strip()

            if len(name) < 3:
                continue

            # Essayer de faire correspondre avec la base de données
            matched_medicine = self._match_medicine(name, dosage, form)

            if matched_medicine:
                medicine_data = {
                    "medicine_name": matched_medicine["name"],
                    "normalized_name": normalize_text(matched_medicine["name"]),
                    "dosage": dosage or matched_medicine.get("dosage", ""),
                    "form": form or matched_medicine.get("form", ""),
                    "quantity": "",
                    "posology": line,
                    "confidence": 0.90,
                    "matched": True,
                }
            else:
                medicine_data = {
                    "medicine_name": name,
                    "normalized_name": normalize_text(name),
                    "dosage": dosage,
                    "form": form,
                    "quantity": "",
                    "posology": line,
                    "confidence": 0.60,
                    "matched": False,
                }

            medicines.append(medicine_data)

        return medicines

    def _match_medicine(self, name: str, dosage: str, form: str) -> Optional[Dict]:
        """Fait correspondre un nom extrait avec la base de données"""
        normalized_name = normalize_text(name)

        # Rechercher dans les médicaments
        best_match = None
        best_score = 0

        # Rechercher par nom normalisé
        medicines = Medicine.objects.filter(is_active=True)

        for medicine in medicines:
            # Score de similarité
            score = self._ratio(normalized_name, medicine.normalized_name)

            # Vérifier aussi les synonymes
            for synonym in medicine.synonyms.all():
                synonym_score = self._ratio(normalized_name, synonym.normalized_synonym)
                if synonym_score > score:
                    score = synonym_score

            if score > best_score and score >= 70:  # Seuil de 70%
                best_score = score
                best_match = {
                    "name": medicine.name,
                    "dosage": medicine.dosage,
                    "form": medicine.form,
                    "score": score,
                }

        return best_match

    def analyze(self, image_path: str, fallback_text: str = "") -> Dict:
        """Analyse complète d'une ordonnance"""
        # Extraire le texte
        text = fallback_text or self.read_image_text(image_path)

        if not text:
            return {
                "raw_text": "",
                "medicines": [],
                "confidence_score": 0,
                "needs_confirmation": True,
                "error": "Impossible d'extraire le texte de l'image.",
            }

        # Extraire les médicaments
        medicines = self.extract_medicines_from_text(text)

        # Calculer le score de confiance
        if medicines:
            confidence = sum(m["confidence"] for m in medicines) / len(medicines)
        else:
            confidence = 0

        # Déterminer si confirmation nécessaire
        needs_confirmation = confidence < 0.80 or any(not m.get("matched", False) for m in medicines)

        return {
            "raw_text": text,
            "medicines": medicines,
            "confidence_score": round(confidence, 2),
            "needs_confirmation": needs_confirmation,
        }


class PharmacyMatchingService:
    """Service de correspondance entre ordonnances et pharmacies"""

    def match(self, prescription) -> List[Dict]:
        """Trouve les pharmacies qui ont les médicaments prescrits"""
        items = prescription.items.all()
        pharmacies = Pharmacy.objects.filter(is_active=True)
        results = []

        for pharmacy in pharmacies:
            matched = []
            missing = []
            partial_matches = []
            total_price = 0

            for item in items:
                # Recherche exacte
                stock = self._find_exact_match(pharmacy, item)

                if stock:
                    matched.append({
                        "medicine": item.medicine_name,
                        "stock_medicine": stock.medicine.name,
                        "quantity": stock.quantity,
                        "price": str(stock.price) if stock.price else None,
                        "match_type": "exact",
                    })
                    if stock.price:
                        total_price += stock.price
                else:
                    # Recherche fuzzy
                    fuzzy_match = self._find_fuzzy_match(pharmacy, item)

                    if fuzzy_match:
                        partial_matches.append({
                            "medicine": item.medicine_name,
                            "stock_medicine": fuzzy_match["stock"].medicine.name,
                            "quantity": fuzzy_match["stock"].quantity,
                            "price": str(fuzzy_match["stock"].price) if fuzzy_match["stock"].price else None,
                            "similarity": fuzzy_match["score"],
                            "match_type": "fuzzy",
                        })
                        if fuzzy_match["stock"].price:
                            total_price += fuzzy_match["stock"].price
                    else:
                        missing.append({
                            "medicine": item.medicine_name,
                            "dosage": item.dosage,
                        })

            # Calculer le score de correspondance
            total_items = len(items)
            matched_count = len(matched) + len(partial_matches)
            match_percentage = (matched_count / total_items * 100) if total_items > 0 else 0

            results.append({
                "pharmacy_id": pharmacy.id,
                "pharmacy_name": pharmacy.name,
                "address": pharmacy.address,
                "phone": pharmacy.phone,
                "is_complete": len(missing) == 0,
                "match_percentage": round(match_percentage, 1),
                "matched_count": matched_count,
                "total_items": total_items,
                "missing_count": len(missing),
                "matched_items": matched,
                "partial_matches": partial_matches,
                "missing_items": missing,
                "estimated_total_price": str(total_price) if total_price else None,
            })

        # Trier par pourcentage de correspondance (décroissant)
        results.sort(key=lambda x: (-x["match_percentage"], -x["matched_count"]))
        return results

    def _find_exact_match(self, pharmacy, item):
        """Recherche exacte d'un médicament dans le stock"""
        return PharmacyStock.objects.filter(
            pharmacy=pharmacy,
            quantity__gt=0
        ).filter(
            Q(medicine__normalized_name=item.normalized_name) |
            Q(medicine__name__icontains=item.medicine_name)
        ).first()

    def _find_fuzzy_match(self, pharmacy, item):
        """Recherche fuzzy d'un médicament dans le stock"""
        stocks = PharmacyStock.objects.filter(pharmacy=pharmacy, quantity__gt=0)

        best_match = None
        best_score = 0

        for stock in stocks:
            # Comparer avec le nom du médicament
            score = self._ratio(item.normalized_name, stock.medicine.normalized_name)

            if score > best_score and score >= 60:
                best_score = score
                best_match = {"stock": stock, "score": score}

            # Comparer avec les synonymes
            for synonym in stock.medicine.synonyms.all():
                score = self._ratio(item.normalized_name, synonym.normalized_synonym)
                if score > best_score and score >= 60:
                    best_score = score
                    best_match = {"stock": stock, "score": score}

        return best_match

    @staticmethod
    def _ratio(left: str, right: str) -> int:
        if fuzz is not None:
            return int(fuzz.ratio(left, right))
        return int(SequenceMatcher(None, left, right).ratio() * 100)


class ChatbotContextService:
    """Assemble le contexte réel PharmiGo selon le rôle de l'utilisateur."""

    def build_context(self, user):
        from apps.chat.models import ChatMessage as InterPharmacyMessage
        from apps.notifications.models import Notification
        from apps.pharmacies.models import Pharmacy as RealPharmacy, PharmacyContact
        from apps.prescriptions.models import (
            MedicationExtraction,
            PharmacyStock as RealPharmacyStock,
            Prescription as RealPrescription,
            PrescriptionResponse,
        )

        profile = getattr(user, "profile", None) if getattr(user, "is_authenticated", False) else None
        role = getattr(profile, "role", "guest") if profile else "guest"
        pharmacy = getattr(profile, "pharmacy", None) if profile else None
        display_name = self._derive_display_name(user)

        context = {
            "role": role,
            "is_authenticated": bool(getattr(user, "is_authenticated", False)),
            "user_id": getattr(user, "id", None),
            "username": getattr(user, "username", "") if getattr(user, "is_authenticated", False) else "",
            "display_name": display_name,
            "address": getattr(profile, "address", "") if profile else "",
            "pending_confirmations": [],
            "recent_notifications": [],
            "recent_prescriptions": [],
            "nearby_pharmacies": [],
            "stock_matches": [],
            "choice_history": [],
            "pharmacy_stock": [],
            "public_prescriptions": [],
            "interactions": [],
            "pharmacy_contacts": [],
            "recent_messages": [],
            "patient_support_profile": {
                "possible_chronic_condition": False,
                "chronic_signals": [],
                "encouragement_style": "standard",
            },
            "conversation_memory": {
                "visit_count": 0,
                "last_visit_at": "",
                "preferred_tone": "standard",
                "recurring_topics": [],
                "recent_user_goals": [],
                "discussed_medications": [],
                "continuity_note": "",
            },
            "response_style": {
                "tone": "neutral",
                "format": "clear",
                "follow_up_bias": "standard",
            },
        }

        if not getattr(user, "is_authenticated", False):
            return context

        context["recent_notifications"] = list(
            Notification.objects.filter(recipient_user=user).order_by("-created_at").values("title", "message", "channel")[:5]
        )

        if role == "patient":
            prescriptions = RealPrescription.objects.filter(patient_user=user).select_related("pharmacy").prefetch_related("extracted_medications")
            context["recent_prescriptions"] = list(
                prescriptions.order_by("-created_at").values("id", "status", "created_at", "medication_name")[:5]
            )
            context["pending_confirmations"] = [
                {
                    "id": item.id,
                    "prescription_id": item.prescription_id,
                    "name": item.name,
                    "dosage": item.dosage,
                    "confidence": item.confidence,
                }
                for item in MedicationExtraction.objects.filter(
                    prescription__patient_user=user,
                    confirmed=False,
                ).order_by("-created_at")[:10]
            ]
            context["choice_history"] = list(
                prescriptions.filter(pharmacy__isnull=False).values(
                    "id",
                    "pharmacy__name",
                    "pharmacy__address",
                    "status",
                )[:10]
            )
            context["stock_matches"] = [
                {
                    "prescription_id": prescription.id,
                    "pharmacy": prescription.pharmacy.name if prescription.pharmacy_id else None,
                    "status": prescription.status,
                }
                for prescription in prescriptions[:10]
            ]
            context["nearby_pharmacies"] = list(
                RealPharmacy.objects.order_by("name").values("id", "name", "address", "city", "phone_number")[:10]
            )
            context["patient_support_profile"] = self._build_patient_support_profile(context["recent_prescriptions"])
        elif role == "pharmacy" and pharmacy is not None:
            context["pharmacy_stock"] = list(
                RealPharmacyStock.objects.filter(pharmacy=pharmacy).order_by("-last_updated").values(
                    "medication_name",
                    "dosage",
                    "quantity",
                    "price",
                    "is_available",
                )[:20]
            )
            context["public_prescriptions"] = list(
                RealPrescription.objects.order_by("-created_at").values(
                    "id",
                    "public_reference",
                    "geo_zone",
                    "status",
                    "created_at",
                )[:10]
            )
            context["interactions"] = list(
                PrescriptionResponse.objects.filter(pharmacy=pharmacy).order_by("-created_at").values(
                    "prescription_id",
                    "availability_note",
                    "status",
                    "estimated_minutes",
                )[:10]
            )
            contact_ids = list(
                PharmacyContact.objects.filter(pharmacy=pharmacy).values_list("contact_pharmacy_id", flat=True)
            )
            context["pharmacy_contacts"] = list(
                RealPharmacy.objects.filter(id__in=contact_ids).values("id", "name", "address", "city")
            )
            context["recent_messages"] = list(
                InterPharmacyMessage.objects.filter(
                    Q(pharmacy=pharmacy) | Q(sender_pharmacy=pharmacy)
                ).order_by("-created_at").values("id", "sender_name", "message", "created_at")[:10]
            )
        elif role == "admin":
            context["recent_messages"] = list(
                InterPharmacyMessage.objects.order_by("-created_at").values("id", "sender_name", "message", "created_at")[:10]
            )

        context["conversation_memory"] = self._build_conversation_memory(user, role)
        context["response_style"] = self._build_response_style(role, context)

        return context

    @staticmethod
    def _derive_display_name(user) -> str:
        if not getattr(user, "is_authenticated", False):
            return ""

        first_name = (getattr(user, "first_name", "") or "").strip()
        last_name = (getattr(user, "last_name", "") or "").strip()
        if first_name and last_name:
            return f"{first_name} {last_name}".strip()
        if first_name:
            return first_name
        return (getattr(user, "username", "") or "").strip()

    @staticmethod
    def _build_patient_support_profile(recent_prescriptions: List[Dict[str, Any]]) -> Dict[str, Any]:
        chronic_markers = {
            "hypertension": ["amlodipine", "losartan", "enalapril"],
            "diabete": ["metformine", "glibenclamide", "insuline", "insulin"],
            "asthme": ["salbutamol", "beclometasone", "budesonide"],
            "epilepsie": ["carbamazepine", "valproate", "phenobarbital", "levetiracetam"],
            "cardiaque": ["bisoprolol", "furosemide", "spironolactone"],
        }

        detected_signals: List[str] = []
        for prescription in recent_prescriptions or []:
            medication_name = normalize_text((prescription or {}).get("medication_name") or "")
            if not medication_name:
                continue
            for label, markers in chronic_markers.items():
                if any(marker in medication_name for marker in markers) and label not in detected_signals:
                    detected_signals.append(label)

        return {
            "possible_chronic_condition": bool(detected_signals),
            "chronic_signals": detected_signals[:4],
            "encouragement_style": "gentle_follow_up" if detected_signals else "standard",
        }

    def _build_conversation_memory(self, user, role: str) -> Dict[str, Any]:
        from .models import ChatbotLearningData, ConversationHistory, ConversationSession

        if not getattr(user, "is_authenticated", False):
            return {
                "visit_count": 0,
                "last_visit_at": "",
                "preferred_tone": "standard",
                "recurring_topics": [],
                "recent_user_goals": [],
                "discussed_medications": [],
                "continuity_note": "",
            }

        sessions = list(
            ConversationSession.objects.filter(user=user)
            .order_by("-updated_at")
            .values("id", "updated_at", "context_snapshot")[:12]
        )
        visit_count = len(sessions)
        last_visit_at = sessions[0]["updated_at"].isoformat() if sessions and sessions[0].get("updated_at") else ""

        history_rows = list(
            ConversationHistory.objects.filter(session__user=user)
            .order_by("-created_at")
            .values("sender", "message", "created_at")[:60]
        )
        history_rows.reverse()
        user_messages = [row for row in history_rows if (row.get("sender") or "").lower() == "user"]

        topic_counts: Dict[str, int] = {
            "medicine_lookup": 0,
            "prescription_help": 0,
            "health_advice": 0,
            "order_follow_up": 0,
            "operations": 0,
        }
        for row in user_messages:
            label = self._classify_memory_topic(row.get("message") or "", role)
            topic_counts[label] = topic_counts.get(label, 0) + 1

        recurring_topics = [
            topic for topic, count in sorted(topic_counts.items(), key=lambda item: (-item[1], item[0])) if count > 0
        ][:4]

        recent_user_goals = [
            (row.get("message") or "")[:160]
            for row in user_messages[-4:]
            if (row.get("message") or "").strip()
        ]

        discussed_medications: List[str] = []
        seen_meds = set()
        learning_rows = ChatbotLearningData.objects.filter(user=user).order_by("-created_at").values(
            "corrected_medicine", "detected_medicine"
        )[:20]
        for row in learning_rows:
            candidate_blob = row.get("corrected_medicine") or row.get("detected_medicine") or ""
            for candidate in [item.strip() for item in candidate_blob.split(",") if item.strip()]:
                normalized_candidate = normalize_text(candidate)
                if normalized_candidate and normalized_candidate not in seen_meds:
                    seen_meds.add(normalized_candidate)
                    discussed_medications.append(candidate)
                if len(discussed_medications) >= 6:
                    break
            if len(discussed_medications) >= 6:
                break

        preferred_tone = self._infer_preferred_tone(role, user_messages)
        continuity_note = self._build_continuity_note(
            role=role,
            visit_count=visit_count,
            recurring_topics=recurring_topics,
            discussed_medications=discussed_medications,
        )

        return {
            "visit_count": visit_count,
            "last_visit_at": last_visit_at,
            "preferred_tone": preferred_tone,
            "recurring_topics": recurring_topics,
            "recent_user_goals": recent_user_goals,
            "discussed_medications": discussed_medications,
            "continuity_note": continuity_note,
        }

    @staticmethod
    def _classify_memory_topic(message: str, role: str) -> str:
        normalized = normalize_text(message or "")
        if any(marker in normalized for marker in ["douleur", "fievre", "fièvre", "effet", "enceinte", "grossesse", "symptome", "symptôme"]):
            return "health_advice"
        if any(marker in normalized for marker in ["ordonnance", "analyser", "analyse", "photo", "upload"]):
            return "prescription_help"
        if any(marker in normalized for marker in ["statut", "livraison", "choix", "reponse", "réponse", "commande"]):
            return "order_follow_up"
        if role == "pharmacy" or any(marker in normalized for marker in ["stock", "prix", "quantite", "quantité", "pharmacie"]):
            return "medicine_lookup"
        return "operations"

    @staticmethod
    def _infer_preferred_tone(role: str, user_messages: List[Dict[str, Any]]) -> str:
        samples = [(row.get("message") or "").strip() for row in user_messages[-8:] if (row.get("message") or "").strip()]
        if role == "admin":
            return "executive"
        if role == "pharmacy":
            return "operational"
        if not samples:
            return "reassuring" if role == "patient" else "standard"

        average_length = sum(len(sample) for sample in samples) / len(samples)
        stress_markers = ["urgent", "vite", "peur", "grave", "douleur", "help", "aide"]
        if any(marker in normalize_text(" ".join(samples)) for marker in stress_markers):
            return "reassuring"
        if average_length < 45:
            return "direct"
        return "guided" if role == "patient" else "standard"

    @staticmethod
    def _build_continuity_note(
        *,
        role: str,
        visit_count: int,
        recurring_topics: List[str],
        discussed_medications: List[str],
    ) -> str:
        role_prefix = {
            "patient": "Le patient revient",
            "pharmacy": "La pharmacie revient",
            "admin": "L'administrateur revient",
        }.get(role, "L'utilisateur revient")
        topic_fragment = f" sur les sujets {', '.join(recurring_topics[:2])}" if recurring_topics else ""
        medication_fragment = f" avec un historique autour de {', '.join(discussed_medications[:2])}" if discussed_medications else ""
        return f"{role_prefix} pour la visite #{max(visit_count, 1)}{topic_fragment}{medication_fragment}."

    @staticmethod
    def _build_response_style(role: str, context: Dict[str, Any]) -> Dict[str, str]:
        memory = context.get("conversation_memory") or {}
        preferred_tone = memory.get("preferred_tone") or "standard"
        if role == "patient":
            return {
                "tone": preferred_tone if preferred_tone in {"reassuring", "guided", "direct"} else "reassuring",
                "format": "supportive_steps",
                "follow_up_bias": "safety_first",
            }
        if role == "pharmacy":
            return {
                "tone": preferred_tone if preferred_tone in {"operational", "direct", "standard"} else "operational",
                "format": "concise_action",
                "follow_up_bias": "workflow_next_step",
            }
        if role == "admin":
            return {
                "tone": "executive",
                "format": "decision_ready",
                "follow_up_bias": "risk_and_action",
            }
        return {
            "tone": preferred_tone,
            "format": "clear",
            "follow_up_bias": "standard",
        }


class GeminiChatService:
    """Gemini-powered conversational layer for PharmiGo chat."""

    def __init__(self):
        self.api_key = getattr(settings, "GEMINI_API_KEY", "").strip()
        self.enabled = bool(getattr(settings, "GEMINI_ENABLED", True))
        self.model = self._normalize_model_name(getattr(settings, "GEMINI_MODEL", "gemini-2.5-flash"))
        self.available = self.enabled and bool(self.api_key)
        self.request_timeout_seconds = 25.0
        self.fallback_models = ["gemini-2.5-flash", "gemini-2.0-flash", "gemini-flash-lite-latest"]

    def generate_response(
        self,
        *,
        question: str,
        role: str,
        internal_answer: str,
        structured_context: Dict[str, Any],
        allow_general_fallback: bool,
        response_kind: str,
    ) -> str:
        if not self.available:
            return ""

        chat_history = self._build_chat_history_contents(structured_context.get("recent_chat_history") or [])
        request_brief = self._build_request_brief(
            question=question,
            role=role,
            internal_answer=internal_answer,
            structured_context=structured_context,
            allow_general_fallback=allow_general_fallback,
            response_kind=response_kind,
        )

        payload = {
            "systemInstruction": {
                "parts": [
                    {
                        "text": self._build_system_prompt()
                    }
                ]
            },
            "contents": chat_history + [
                {
                    "role": "user",
                    "parts": [{"text": request_brief}],
                }
            ],
            "generationConfig": {
                "temperature": 0.6,
                "maxOutputTokens": 1024,
                "thinkingConfig": {
                    "thinkingBudget": 0,
                },
            },
        }

        started_at = time.perf_counter()
        try:
            raw_response, used_model = self._generate_content(payload)
        except error.HTTPError as exc:
            body = ""
            try:
                body = exc.read().decode("utf-8", errors="ignore")
            except Exception:
                body = ""
            logger.warning("Gemini chatbot HTTP error %s: %s", exc.code, body[:2000] or exc)
            return ""
        except Exception as exc:  # pragma: no cover - network dependent
            logger.warning("Gemini chatbot request failed: %s", exc)
            return ""

        response_time_ms = int((time.perf_counter() - started_at) * 1000)
        logger.info(
            "Gemini chatbot response generated",
            extra={
                "gemini_model": used_model,
                "response_time_ms": response_time_ms,
                "response_kind": response_kind,
            },
        )
        return self._extract_text_content(raw_response).strip()

    def _build_system_prompt(self) -> str:
        return (
            "PROMPT SYSTÈME FINAL : PHARMIGO HYBRIDE (TECH & BUSINESS)\n"
            "Tu es PharmiGo, l'intelligence centrale de la plateforme PharmiGo. "
            "Tu es un assistant de santé empathique, humain, cohérent et rassurant. "
            "Tu accompagnes l'utilisateur autour du bien-être, de la santé générale, de la prévention, des médicaments, des ordonnances et des pharmacies partenaires, sans jamais remplacer un médecin.\n\n"
            "1. ARCHITECTURE DE RÉPONSE : NE RIEN CASSER\n"
            "- Tu fonctionnes toujours avec trois piliers indissociables : le pilier technique, le pilier humain et le pilier business.\n"
            "- Pilier technique : quand des faits internes sont fournis, ils restent prioritaires et fiables (OCR, analyse d'ordonnance, historique, stocks, profils, messages précédents).\n"
            "- Pilier humain : applique une couche d'interprétation bienveillante pour comprendre les fautes, la confusion, la fatigue, le stress et le besoin réel derrière les mots.\n"
            "- Pilier business : pour toute recommandation de pharmacie, de produit, de médicament en stock ou d'orientation vers une officine, ne rends visibles que les Partenaires Certifiés PharmiGo éligibles.\n\n"
            "2. COUCHE D'INTERPRÉTATION (IntentClarificationLayer)\n"
            "- Si l'utilisateur écrit avec des fautes, ne le corrige pas sèchement. Déduis son besoin et reformule doucement si nécessaire.\n"
            "- Si l'utilisateur semble confus, reformule toujours brièvement : « Si je comprends bien... » ou équivalent naturel dans sa langue.\n"
            "- Si l'utilisateur parle d'émotions, de fatigue, de stress, de douleur ou de gêne, commence par l'écoute active et l'empathie.\n"
            "- Si l'utilisateur change de sujet, reconnais la transition avec naturel avant de poursuivre.\n\n"
            "3. RÈGLE D'OR : L'ÉCOUTE ACTIVE\n"
            "- Réponds d'abord au vrai message de l'utilisateur.\n"
            "- Ne récite jamais spontanément la liste de tes capacités.\n"
            "- Si l'utilisateur salue, remercie, fait une petite discussion ou clôture l'échange, réponds comme un humain vivant.\n"
            "- Quand l'utilisateur est connecté, adopte un ton plus personnel, plus précis et plus chaleureux, sans devenir intrusif.\n\n"
            "4. MÉMOIRE ET CONTEXTE\n"
            "- Tu reçois un historique récent : utilise-le réellement.\n"
            "- Traite la conversation comme un flux continu et cohérent.\n"
            "- Ne réponds jamais comme si chaque message était le premier.\n"
            "- Si l'utilisateur revient plus tard, tu peux reprendre le fil si l'historique le justifie.\n\n"
            "5. LOGIQUE DE RECOMMANDATION EXCLUSIVE (BUSINESS)\n"
            "- Pour toute recommandation de pharmacie ou de stock, ne propose que les pharmacies partenaires éligibles.\n"
            "- Une pharmacie éligible est un Partenaire Certifié PharmiGo, soit parce qu'elle est vérifiée avec abonnement actif, soit parce qu'elle est en période d'essai active.\n"
            "- Les pharmacies non certifiées, expirées, suspendues ou annulées restent invisibles dans les suggestions.\n"
            "- Si aucune pharmacie éligible n'est trouvée, dis clairement : « Je n'ai pas de partenaire certifié disponible dans cette zone pour le moment. »\n"
            "- Quand tu proposes une pharmacie éligible, mentionne explicitement « Partenaire Certifié PharmiGo ».\n\n"
            "6. STRUCTURE DE RÉPONSE OBLIGATOIRE\n"
            "- Accueil et empathie.\n"
            "- Conseil santé ou bien-être immédiat quand c'est utile.\n"
            "- Analyse technique si des faits internes fiables sont disponibles (ordonnance, OCR, stocks, historique).\n"
            "- Orientation produit et lieu, seulement avec partenaires certifiés éligibles.\n"
            "- Relance finale douce pour garder le fil de la conversation.\n\n"
            "7. LIMITES MÉDICALES STRICTES\n"
            "- Tu ne poses jamais de diagnostic certain.\n"
            "- Tu ne prescris jamais un nouveau traitement.\n"
            "- Tu ne modifies jamais une dose ou un traitement prescrit.\n"
            "- Tu peux expliquer à quoi sert un médicament déjà connu, ses précautions générales, ses effets secondaires courants ou quoi faire en cas d'oubli, mais sans fixer de posologie nouvelle.\n"
            "- En cas de signes de gravité ou d'urgence, ignore toute logique commerciale et conseille immédiatement de contacter les urgences ou un professionnel de santé.\n"
            "- Rappelle quand c'est utile que tes conseils sont informatifs et ne remplacent pas l'avis d'un médecin ou d'un pharmacien.\n\n"
            "8. CONFIDENTIALITÉ ET CONNEXION\n"
            "- Si l'utilisateur non connecté veut parler d'un sujet sensible, privé ou de suivi, invite-le doucement à se connecter pour un échange plus personnel et plus continu.\n"
            "- Si l'utilisateur est connecté, tu peux utiliser son prénom avec parcimonie et rappeler que vous êtes dans son espace personnel PharmiGo, sans promettre une confidentialité technique absolue.\n\n"
            "9. LANGUES\n"
            "- Réponds dans la langue dominante du message reçu : français, kirundi, swahili, anglais ou lingala.\n\n"
            "10. STYLE DE SORTIE\n"
            "- Pas de JSON, pas de markdown complexe.\n"
            "- Pas de réponses répétitives, figées ou robotiques.\n"
            "- Réponse naturelle, claire, utile, humaine et contextualisée.\n"
            "- Pose une question de suivi seulement si elle aide vraiment.\n"
            "- Si l'utilisateur dit au revoir, bonne nuit, merci c'est bon, etc., fais une clôture courte, douce et naturelle."
        )

    def _build_request_brief(
        self,
        *,
        question: str,
        role: str,
        internal_answer: str,
        structured_context: Dict[str, Any],
        allow_general_fallback: bool,
        response_kind: str,
    ) -> str:
        conversation_profile = structured_context.get("conversation_profile") or {}
        response_style = structured_context.get("response_style") or {}
        patient_support = structured_context.get("patient_support_profile") or {}
        recent_chat_history = structured_context.get("recent_chat_history") or []
        recent_topics = [row.get("message", "") for row in recent_chat_history[-4:]]
        stock_matches = structured_context.get("stock_matches") or []
        medication_names = structured_context.get("medication_names") or []
        public_facts = {
            "role": role,
            "response_kind": response_kind,
            "is_authenticated": structured_context.get("is_authenticated"),
            "display_name": structured_context.get("display_name") or "",
            "detected_language": conversation_profile.get("detected_language") or "fr",
            "recent_topic_transition": conversation_profile.get("recent_topic_transition") or "",
            "conversation_turns": conversation_profile.get("turn_count") or 0,
            "can_use_name": conversation_profile.get("can_use_name") or False,
            "preferred_tone": response_style.get("tone") or "standard",
            "possible_chronic_condition": patient_support.get("possible_chronic_condition") or False,
            "medication_names": medication_names[:8],
            "stock_matches": stock_matches[:4],
            "recent_topics": recent_topics,
        }
        return (
            "Dernier message utilisateur :\n"
            f"{question}\n\n"
            "Instructions de réponse immédiates :\n"
            "- Répondez d'abord à ce dernier message, naturellement.\n"
            "- Ne récitez pas vos fonctions ni la liste de vos capacités.\n"
            "- Utilisez les faits internes comme base technique fiable lorsqu'ils existent.\n"
            "- N'ouvrez une recherche de stock, de produit ou de pharmacie que si la demande ou les faits l'exigent vraiment.\n"
            "- Pour toute orientation vers une pharmacie, ne recommandez que des partenaires certifiés PharmiGo éligibles.\n"
            "- Si aucun partenaire certifié n'est disponible, dites-le clairement sans mentionner de pharmacie non éligible.\n"
            "- Si l'utilisateur écrit avec des fautes, de la fatigue ou de la confusion, interprétez son besoin avec empathie et reformulez doucement si cela aide.\n"
            "- Si `internal_answer` contient des faits fiables, utilisez-les discrètement comme base.\n"
            "- Si `response_kind` concerne une salutation, une confidentialité, une connexion, un au revoir ou une conversation générale, ne basculez jamais vers une recherche de stock.\n"
            "- Si l'utilisateur semble parler santé ou bien-être, soyez empathique, prudent, utile et vivant.\n"
            "- S'il y a un sujet sensible et que l'utilisateur n'est pas connecté, invitez-le doucement à se connecter pour un accompagnement plus personnel.\n\n"
            "Faits internes fiables éventuellement disponibles :\n"
            f"{internal_answer or 'Aucun fait interne supplémentaire à citer mot à mot.'}\n\n"
            "Contexte structuré utile :\n"
            f"{json.dumps(public_facts, ensure_ascii=False)}\n\n"
            "Rédigez maintenant une réponse vivante, humaine, cohérente avec l'historique et compatible avec les règles business."
        )

    @staticmethod
    def _build_chat_history_contents(recent_chat_history: List[Dict[str, str]]) -> List[Dict[str, Any]]:
        contents: List[Dict[str, Any]] = []
        for row in recent_chat_history[-15:]:
            sender = (row.get("sender") or "").lower()
            message = (row.get("message") or "").strip()
            if not message:
                continue
            role = "model" if sender in {"bot", "assistant", "model"} else "user"
            contents.append(
                {
                    "role": role,
                    "parts": [{"text": message[:1200]}],
                }
            )
        return contents

    def _generate_content(self, payload: Dict[str, Any]) -> Tuple[Dict[str, Any], str]:
        candidate_models = [self.model]
        for model_name in self.fallback_models:
            normalized = self._normalize_model_name(model_name)
            if normalized not in candidate_models:
                candidate_models.append(normalized)

        last_http_error = None
        last_generic_error = None
        for model_name in candidate_models:
            endpoint = f"https://generativelanguage.googleapis.com/v1beta/models/{model_name}:generateContent?key={self.api_key}"
            req = request.Request(
                endpoint,
                data=json.dumps(payload).encode("utf-8"),
                headers={"Content-Type": "application/json"},
                method="POST",
            )
            try:
                with request.urlopen(req, timeout=self.request_timeout_seconds) as response:
                    body = response.read().decode("utf-8")
                return json.loads(body), model_name
            except error.HTTPError as exc:
                last_http_error = exc
                if exc.code not in {404, 429, 500, 503}:
                    raise
            except Exception as exc:  # pragma: no cover - network dependent
                last_generic_error = exc

        if last_http_error is not None:
            raise last_http_error
        if last_generic_error is not None:
            raise last_generic_error
        raise RuntimeError("No Gemini model responded.")

    @staticmethod
    def _extract_text_content(raw_response: Dict[str, Any]) -> str:
        texts: List[str] = []
        for candidate in raw_response.get("candidates") or []:
            content = candidate.get("content") or {}
            for part in content.get("parts") or []:
                text = (part.get("text") or "").strip()
                if text:
                    texts.append(text)
        return "\n".join(texts).strip()

    @staticmethod
    def _normalize_model_name(model_name: str) -> str:
        value = (model_name or "").strip()
        if value.startswith("models/"):
            return value.split("/", 1)[1]
        return value or "gemini-2.5-flash"


class ChatbotResponseService:
    """Réponses intelligentes avec base de connaissances + données réelles."""

    MEDICINE_REQUEST_MARKERS = [
        "medicament",
        "médicament",
        "pharmacie",
        "stock",
        "disponible",
        "disponibilite",
        "disponibilité",
        "ordonnance",
        "acheter",
        "trouver",
        "recherche de stock",
        "ou acheter",
        "où acheter",
        "dans quelle pharmacie",
        "en stock",
    ]

    GENERAL_CONVERSATION_MARKERS = [
        "bonjour",
        "salut",
        "bonsoir",
        "coucou",
        "hello",
        "hi",
        "comment ca va",
        "comment ça va",
        "comment vas tu",
        "comment allez vous",
        "merci",
        "merci beaucoup",
        "je t aime",
        "je t'aime",
        "je vous aime",
        "je t apprecie",
        "je t'apprécie",
        "tu m aides",
        "tu m'aides",
        "qui es tu",
        "que fais tu",
        "que peux tu faire",
        "comment utiliser",
        "comment ca marche",
        "comment ça marche",
        "aide moi",
        "presente toi",
        "présente toi",
    ]

    FAREWELL_MARKERS = [
        "au revoir",
        "aurevoir",
        "a plus",
        "a bientôt",
        "a bientot",
        "bonne nuit",
        "bonne journee",
        "bonne journée",
        "bye",
        "goodbye",
        "see you",
        "merci c est bon",
        "merci c'est bon",
        "ok merci",
        "d accord merci",
        "d'accord merci",
        "ca va merci",
        "c est bon merci",
        "c'est bon merci",
    ]

    PRIVACY_MARKERS = [
        "confidentiel",
        "confidentielle",
        "confidentialite",
        "confidentialité",
        "prive",
        "privé",
        "privee",
        "privée",
        "entre toi et moi",
        "entre vous et moi",
        "en prive",
        "en privé",
        "plus discret",
        "plus discrete",
        "plus intime",
        "securise",
        "sécurisé",
        "trop personnel",
        "tres personnel",
        "très personnel",
        "ma situation",
        "mon cas",
        "en discuter plus",
        "discuter plus",
        "parler entre nous",
        "plus de confidentialite",
        "plus de confidentialité",
        "parler de quelque chose de plus prive",
        "parler de quelque chose de plus privé",
    ]

    CONNECTION_INTENT_MARKERS = [
        "je vais me connecter",
        "je vais me reconnecter",
        "je me connecte",
        "je vais venir en prive",
        "je vais venir en privé",
        "on va parler en prive",
        "on va parler en privé",
        "je reviens connecte",
        "je reviens connecté",
        "je vais revenir connecte",
        "je vais revenir connecté",
        "je vais venir dans mon compte",
    ]

    HEALTH_QUESTION_MARKERS = [
        "douleur",
        "fievre",
        "fièvre",
        "souffr",
        "soufr",
        "malade",
        "je suis mal",
        "je me sens mal",
        "je ne me sens pas bien",
        "pas bien",
        "fatigue",
        "fatigué",
        "fatiguee",
        "fatiguée",
        "faible",
        "faiblesse",
        "epuise",
        "épuisé",
        "epuisee",
        "épuisée",
        "angoisse",
        "anxieux",
        "anxieuse",
        "stress",
        "symptome",
        "symptôme",
        "enceinte",
        "grossesse",
        "allait",
        "effet secondaire",
        "effets secondaires",
        "danger",
        "grave",
        "vomissement",
        "diarrhee",
        "diarrhée",
        "toux",
        "respirer",
        "respiration",
        "enfant",
        "bebe",
        "bébé",
        "interaction",
        "associer",
        "combiner",
        "dose",
        "dosage",
        "chronique",
        "chronic",
        "deprime",
        "déprime",
        "depression",
        "dépression",
        "espoir",
        "desespoir",
        "désespoir",
        "tristesse",
        "diabet",
        "hypertension",
        "hypertendu",
        "asthme",
        "asthmatique",
        "sommeil",
        "insomnie",
        "manger",
        "alimentation",
        "nourriture",
        "regime",
        "régime",
        "sport",
        "activite physique",
        "activité physique",
        "stressé",
        "stresse",
        "bien etre",
        "bien-être",
        "confidentiel",
        "confidentielle",
    ]

    def __init__(self):
        from apps.prescriptions.services.qa_service import QAService

        self.qa_service = QAService()
        self.context_service = ChatbotContextService()
        self.gemini_chat = GeminiChatService()

    def answer(self, question, user=None, session=None, preferred_language: str | None = None):
        from .models import ChatbotKnowledgeBase, ChatbotLearningData

        cleaned_question = (question or "").strip()
        context = self.context_service.build_context(user)
        context = self._inject_preferred_language(context, preferred_language)
        role = context["role"] if context["role"] in {"patient", "pharmacy", "admin"} else "all"
        lowered_question = cleaned_question.lower()
        medication_names: List[str] = []
        medication_name = ""
        qa_answer = ""

        internal_answer = ""
        response_kind = "general_conversation"
        allow_general_fallback = True
        detected_intent = "general_conversation"
        confidence_before = 0.5
        confidence_after = 0.75
        corrected_medicine = ""

        if self._looks_like_farewell(cleaned_question):
            response_kind = "farewell"
            detected_intent = "farewell"
        elif self._looks_like_connection_intent(cleaned_question):
            response_kind = "connection_intent"
            detected_intent = "connection_intent"
        elif self._looks_like_privacy_request(cleaned_question):
            response_kind = "privacy_guidance"
            detected_intent = "privacy_guidance"
        elif self._looks_like_platform_usage_question(cleaned_question):
            response_kind = "platform_usage"
            detected_intent = "platform_usage"
            internal_answer = self._answer_platform_usage_question(lowered_question)
        else:
            health_answer = self._answer_health_question(cleaned_question, role, context)
            if health_answer:
                internal_answer = health_answer
                response_kind = "health_guidance"
                detected_intent = "health_guidance"
                confidence_after = 0.8
            elif self._looks_like_medication_guidance_request(cleaned_question):
                response_kind = "medication_guidance"
                detected_intent = "medication_guidance"
                medication_names = self._detect_medicine_names(cleaned_question)
                if medication_names:
                    medication_name = medication_names[0]
                    qa_answer = self.qa_service.answer_question(cleaned_question, user)
                    if qa_answer and not self._looks_like_stock_error_response(qa_answer):
                        internal_answer = qa_answer

        if not internal_answer and self._should_search_stock(cleaned_question):
            medication_names = self._detect_medicine_names(cleaned_question)
            medication_name = medication_names[0] if medication_names else ""

        if medication_names and not internal_answer and response_kind != "medication_guidance":
            lookup_answer, lookup_confidence = self._answer_medicine_lookup(
                medication_names=medication_names,
                role=role,
                user=user,
            )
            if lookup_answer:
                internal_answer = lookup_answer
                response_kind = "medicine_lookup"
                detected_intent = "medicine_lookup"
                confidence_before = 0.55
                confidence_after = lookup_confidence
                corrected_medicine = ", ".join(
                    [self._find_learned_medicine_name(name) or name for name in medication_names]
                )

        if not internal_answer and medication_name and "Je n'ai pas trouvé ce médicament" in qa_answer:
            learned_name = self._find_learned_medicine_name(medication_name) or medication_name
            personalized = (
                f"Je comprends votre demande. Je connais bien le medicament {learned_name}, "
                "mais il n'est actuellement disponible dans aucune de mes pharmacies."
            )
            internal_answer = personalized
            response_kind = "medicine_not_found"
            detected_intent = "medicine_not_found"
            confidence_before = 0.3
            confidence_after = 0.8
            corrected_medicine = learned_name

        if not internal_answer and response_kind == "medication_guidance":
            internal_answer = self._personalize_answer(qa_answer, role, context, medication_name)
            response_kind = "medicine_question"
            detected_intent = "medication_guidance"

        conversational_intents = {
            "farewell",
            "connection_intent",
            "privacy_guidance",
            "general_conversation",
            "platform_usage",
            "health_guidance",
            "medication_guidance",
        }

        if not internal_answer and response_kind not in conversational_intents:
            kb_answer = self._knowledge_answer(ChatbotKnowledgeBase, cleaned_question, role)
            if kb_answer:
                internal_answer = self._personalize_answer(kb_answer, role, context, medication_name)
                response_kind = "knowledge_base"
                detected_intent = "knowledge_base"
                confidence_before = 0.6
                confidence_after = 0.9
                allow_general_fallback = False

        final_answer = self._compose_final_answer(
            question=cleaned_question,
            role=role,
            context=context,
            user=user,
            session=session,
            internal_answer=internal_answer,
            response_kind=response_kind,
            medication_names=medication_names or ([medication_name] if medication_name else []),
            allow_general_fallback=allow_general_fallback,
        )

        if not final_answer:
            final_answer = self._build_local_fallback(
                question=cleaned_question,
                role=role,
                context=context,
                response_kind=response_kind,
            )
            detected_intent = detected_intent or "general_fallback"
            if response_kind == "general_fallback":
                response_kind = "general_fallback"

        self._record_learning(
            ChatbotLearningData,
            user=user,
            original_text=cleaned_question,
            detected_intent=detected_intent,
            detected_medicine=", ".join(medication_names) if medication_names else (medication_name or ""),
            corrected_medicine=corrected_medicine,
            corrected_answer=final_answer,
            source=role if role in {"patient", "pharmacy", "admin"} else "system",
            confidence_before=confidence_before,
            confidence_after=confidence_after,
        )
        return final_answer

    @staticmethod
    def _inject_preferred_language(context: Dict[str, Any], preferred_language: Optional[str]) -> Dict[str, Any]:
        language = (preferred_language or "").strip().lower()
        if language not in {"fr", "en", "rn", "sw", "ln"}:
            return context
        enriched_context = dict(context)
        enriched_context["preferred_language"] = language
        return enriched_context

    def _compose_final_answer(
        self,
        *,
        question: str,
        role: str,
        context: Dict[str, Any],
        user=None,
        session=None,
        internal_answer: str,
        response_kind: str,
        medication_names: Optional[List[str]] = None,
        allow_general_fallback: bool,
    ) -> str:
        medication_name = medication_names[0] if medication_names else ""
        personalized_answer = self._personalize_answer(internal_answer, role, context, medication_name)
        structured_context = self._build_gemini_context_payload(
            role=role,
            context=context,
            user=user,
            session=session,
            medication_names=medication_names or [],
        )
        gemini_answer = self.gemini_chat.generate_response(
            question=question,
            role=role,
            internal_answer=personalized_answer,
            structured_context=structured_context,
            allow_general_fallback=allow_general_fallback,
            response_kind=response_kind,
        )
        if gemini_answer:
            return gemini_answer
        if personalized_answer:
            return personalized_answer
        return ""

    def _build_local_fallback(
        self,
        *,
        question: str,
        role: str,
        context: Dict[str, Any],
        response_kind: str,
    ) -> str:
        if response_kind == "farewell":
            return self._build_farewell_seed(question=question, role=role, context=context)
        if response_kind == "connection_intent":
            return self._build_connection_seed(question=question, role=role, context=context)
        if response_kind == "privacy_guidance":
            return self._build_privacy_seed(question=question, role=role, context=context)
        if response_kind == "general_conversation":
            return self._build_general_conversation_seed(question=question, role=role, context=context)
        return self._fallback_answer(role, context)

    def _build_gemini_context_payload(
        self,
        *,
        role: str,
        context: Dict[str, Any],
        user=None,
        session=None,
        medication_names: List[str],
    ) -> Dict[str, Any]:
        recent_chat_history = self._get_recent_chat_history(user=user, session=session)
        return {
            "role": role,
            "is_authenticated": bool(context.get("is_authenticated")),
            "username": context.get("username") or "",
            "display_name": context.get("display_name") or "",
            "address": context.get("address") or "",
            "medication_names": medication_names[:10],
            "pending_confirmations_count": len(context.get("pending_confirmations") or []),
            "recent_notifications": (context.get("recent_notifications") or [])[:4],
            "recent_prescriptions": (context.get("recent_prescriptions") or [])[:4],
            "nearby_pharmacies": (context.get("nearby_pharmacies") or [])[:5],
            "stock_matches": (context.get("stock_matches") or [])[:5],
            "pharmacy_stock": (context.get("pharmacy_stock") or [])[:8],
            "public_prescriptions": (context.get("public_prescriptions") or [])[:6],
            "pharmacy_contacts": (context.get("pharmacy_contacts") or [])[:5],
            "recent_messages": (context.get("recent_messages") or [])[:5],
            "recent_chat_history": recent_chat_history,
            "conversation_profile": self._build_conversation_profile(
                recent_chat_history=recent_chat_history,
                context=context,
            ),
            "conversation_memory": context.get("conversation_memory") or {},
            "response_style": context.get("response_style") or {},
            "patient_support_profile": context.get("patient_support_profile") or {},
        }

    @staticmethod
    def _get_recent_chat_history(*, user=None, session=None) -> List[Dict[str, str]]:
        from .models import ConversationHistory

        queryset = ConversationHistory.objects.none()
        if getattr(user, "is_authenticated", False):
            queryset = ConversationHistory.objects.filter(user=user)
        elif session is not None:
            queryset = ConversationHistory.objects.filter(session=session)

        recent_rows = queryset.order_by("-created_at").values("sender", "message", "created_at")[:15]
        history = list(reversed(list(recent_rows)))
        return [
            {
                "sender": row["sender"],
                "message": row["message"][:600],
                "created_at": row["created_at"].isoformat() if row.get("created_at") else "",
            }
            for row in history
        ]

    def _build_conversation_profile(
        self,
        *,
        recent_chat_history: List[Dict[str, str]],
        context: Dict[str, Any],
    ) -> Dict[str, Any]:
        recent_user_messages = [
            row for row in recent_chat_history if (row.get("sender") or "").lower() == "user"
        ]
        first_user_message = recent_user_messages[0]["message"] if recent_user_messages else ""
        latest_user_message = recent_user_messages[-1]["message"] if recent_user_messages else ""
        normalized_first = normalize_text(first_user_message)
        greeting_markers = ["bonjour", "salut", "bonsoir", "coucou", "amakuru", "jambo", "habari", "mbote"]
        started_with_greeting = any(marker in normalized_first for marker in greeting_markers)

        return {
            "turn_count": len(recent_chat_history),
            "user_turn_count": len(recent_user_messages),
            "is_new_conversation": len(recent_chat_history) <= 2,
            "started_with_greeting": started_with_greeting,
            "should_greet_now": len(recent_chat_history) <= 2,
            "can_use_name": bool(context.get("display_name")),
            "is_private_authenticated_space": bool(context.get("is_authenticated")),
            "detected_language": self._resolve_response_language(
                latest_user_message or first_user_message,
                context,
            ),
            "recent_topic_transition": self._detect_topic_transition(recent_user_messages),
        }

    def _detect_topic_transition(self, recent_user_messages: List[Dict[str, str]]) -> str:
        if len(recent_user_messages) < 2:
            return ""

        previous_message = normalize_text(recent_user_messages[-2].get("message") or "")
        latest_message = normalize_text(recent_user_messages[-1].get("message") or "")
        if not previous_message or not latest_message:
            return ""

        previous_topic = self._infer_message_topic(previous_message)
        latest_topic = self._infer_message_topic(latest_message)
        if previous_topic == latest_topic:
            return ""
        return f"transition de {previous_topic} vers {latest_topic}"

    def _infer_message_topic(self, normalized_message: str) -> str:
        if any(marker in normalized_message for marker in ["douleur", "fievre", "symptome", "fatigue", "stress", "anx", "malade", "souffr", "soufr", "chronique"]):
            return "sante"
        if any(marker in normalized_message for marker in ["medicament", "pharmacie", "stock", "ordonnance", "dose", "dosage", "traitement"]):
            return "medicaments"
        if any(marker in normalized_message for marker in ["connect", "prive", "privé", "confident", "espace personnel", "mon compte"]):
            return "confidentialite"
        if any(marker in normalized_message for marker in ["bonjour", "salut", "bonsoir", "merci", "au revoir", "bye"]):
            return "conversation"
        return "general"

    def _looks_like_platform_usage_question(self, question: str) -> bool:
        lowered = normalize_text(question or "")
        if not lowered:
            return False
        patterns = [
            ("page d accueil" in lowered and "ordonnance" in lowered and ("publier" in lowered or "puis je" in lowered)),
            ("apres ma connexion" in lowered),
            ("comment publier" in lowered and "ordonnance" in lowered),
            ("comment utiliser pharmigo" in lowered),
            ("comment ca marche" in lowered and "pharmigo" in lowered),
            ("comment ça marche" in lowered and "pharmigo" in lowered),
        ]
        return any(patterns)

    @staticmethod
    def _answer_platform_usage_question(lowered_question: str) -> str:
        if "page d'accueil" in lowered_question or "page d accueil" in lowered_question:
            return "Un patient connecté peut publier son ordonnance depuis la page d'accueil sans devoir passer obligatoirement par son dashboard."
        if "après ma connexion" in lowered_question or "apres ma connexion" in lowered_question:
            return "Après la connexion, l'utilisateur arrive sur la page d'accueil et peut ensuite utiliser le chatbot, consulter les pharmacies, voir les ordonnances publiques ou ouvrir son dashboard."
        if "comment publier" in lowered_question and "ordonnance" in lowered_question:
            return "Une ordonnance peut être publiée depuis la page d'accueil ou depuis le dashboard. Après l'envoi, la plateforme lance l'analyse et aide à trouver les médicaments disponibles."
        return "PharmiGo guide l'utilisateur entre la page d'accueil, le dashboard, les pharmacies et les ordonnances selon ce qu'il veut faire."

    def _looks_like_medication_guidance_request(self, question: str) -> bool:
        lowered = normalize_text(question or "")
        if not lowered:
            return False
        if self._looks_like_general_conversation(lowered) or self._looks_like_privacy_request(lowered) or self._looks_like_connection_intent(lowered):
            return False
        if any(marker in lowered for marker in ["effet secondaire", "effets secondaires", "sert a quoi", "sert à quoi", "oubli de prise", "interaction", "allergie", "allergies", "precaution", "précaution"]):
            return True
        return bool(self._detect_medicine_names(question))

    def _should_search_stock(self, question: str) -> bool:
        lowered = normalize_text(question or "")
        if not lowered:
            return False
        if self._looks_like_general_conversation(lowered) or self._looks_like_farewell(lowered) or self._looks_like_privacy_request(lowered) or self._looks_like_connection_intent(lowered) or self._looks_like_health_question(lowered):
            return False
        if not any(marker in lowered for marker in self.MEDICINE_REQUEST_MARKERS):
            return False
        if not self._looks_like_stock_search_intent(lowered):
            return False
        return bool(self._detect_medicine_names(question))

    @staticmethod
    def _looks_like_stock_search_intent(question: str) -> bool:
        lowered = normalize_text(question or "")
        explicit_markers = [
            "dans quelle pharmacie",
            "dans quelle phramacie",
            "ou acheter",
            "où acheter",
            "ou trouver",
            "où trouver",
            "en stock",
            "est disponible",
            "sont disponibles",
            "disponibilite",
            "disponibilité",
            "cherche ce medicament",
            "recherche ce medicament",
            "avez vous",
            "as tu",
            "a tu",
            "y a t il",
            "y a-t-il",
        ]
        return any(marker in lowered for marker in explicit_markers)

    @staticmethod
    def _looks_like_stock_error_response(answer: str) -> bool:
        lowered = normalize_text(answer or "")
        return "probleme technique temporaire pendant la recherche des stocks" in lowered or "aucun stock correspondant" in lowered

    def _detect_medicine_name(self, question):
        medications = self.qa_service._extract_requested_medications(question.lower())
        if medications:
            return medications[0]
        learned_name = self._find_learned_medicine_name(question)
        return learned_name or ""

    def _detect_medicine_names(self, question: str) -> List[str]:
        medications = self.qa_service._extract_requested_medications((question or "").lower())
        unique_medications: List[str] = []
        seen_normalized = set()

        for medication in medications:
            normalized_medication = normalize_text(medication)
            if not normalized_medication or normalized_medication in seen_normalized:
                continue
            seen_normalized.add(normalized_medication)
            unique_medications.append(medication)

        if self._looks_like_stock_search_intent(question):
            for medication in self._extract_raw_medicine_candidates(question):
                normalized_medication = normalize_text(medication)
                if not normalized_medication or normalized_medication in seen_normalized:
                    continue
                if any(self._token_set_ratio(normalized_medication, seen_name) >= 92 for seen_name in seen_normalized):
                    continue
                learned_match = self._find_learned_medicine_name(medication)
                if not learned_match:
                    continue
                seen_normalized.add(normalize_text(learned_match))
                unique_medications.append(learned_match)

        if unique_medications:
            return unique_medications[:10]
        return []

    def _extract_raw_medicine_candidates(self, question: str) -> List[str]:
        if not self._looks_like_stock_search_intent(question):
            return []

        normalized_question = re.sub(r"[^\w\s,&/+.-]", " ", (question or "").lower())
        segments = re.split(r",|;|\bet\b|\band\b|/|\+|&", normalized_question)
        ignored = {
            "dans", "quelle", "pharmacie", "puis", "peux", "trouver", "medicament", "medicaments",
            "comment", "avoir", "avec", "alors", "pour", "moi", "mon", "mes", "je", "veux",
            "ou", "où", "cherche", "recherche", "disponible", "disponibles", "besoin", "de",
            "du", "des", "la", "le", "les", "une", "un", "me", "ma", "mes",
        }

        candidates: List[str] = []
        for segment in segments:
            tokens = [token.strip(" .-") for token in segment.split() if token.strip(" .-")]
            meaningful_tokens = [token for token in tokens if token not in ignored]
            if not meaningful_tokens:
                continue
            candidates.append(" ".join(meaningful_tokens[:3]))

        return candidates

    def _looks_like_medication_request(self, question):
        lowered = question.lower()
        if self._looks_like_general_conversation(lowered):
            return False
        if self._looks_like_farewell(lowered):
            return False
        if self._looks_like_privacy_request(lowered):
            return False
        if self._looks_like_connection_intent(lowered):
            return False
        if self._looks_like_health_question(lowered):
            return False
        return self._looks_like_stock_search_intent(lowered) and bool(self._detect_medicine_names(question))

    def _looks_like_general_conversation(self, question: str) -> bool:
        lowered = normalize_text(question or "")
        if not lowered:
            return False

        return any(marker in lowered for marker in self.GENERAL_CONVERSATION_MARKERS)

    def _looks_like_farewell(self, question: str) -> bool:
        lowered = normalize_text(question or "")
        if not lowered:
            return False
        return any(marker in lowered for marker in self.FAREWELL_MARKERS)

    def _looks_like_privacy_request(self, question: str) -> bool:
        lowered = normalize_text(question or "")
        if not lowered:
            return False
        return any(marker in lowered for marker in self.PRIVACY_MARKERS)

    def _looks_like_connection_intent(self, question: str) -> bool:
        lowered = normalize_text(question or "")
        if not lowered:
            return False
        return any(marker in lowered for marker in self.CONNECTION_INTENT_MARKERS)

    def _looks_like_health_question(self, question: str) -> bool:
        lowered = normalize_text(question or "")
        if not lowered or self._looks_like_general_conversation(lowered):
            return False
        return any(marker in lowered for marker in self.HEALTH_QUESTION_MARKERS)

    def _build_general_conversation_seed(self, *, question: str, role: str, context: Dict[str, Any]) -> str:
        normalized = normalize_text(question or "")
        display_name = context.get("display_name") or ""
        profile = context.get("conversation_profile") or {}
        should_greet = bool(profile.get("should_greet_now"))
        language = self._resolve_response_language(question, context)

        if any(marker in normalized for marker in ["bonjour", "salut", "bonsoir", "coucou", "amakuru", "jambo", "habari", "mbote"]):
            greeting_map = {
                "fr": "Bonjour" if should_greet else "Rebonjour",
                "en": "Hello" if should_greet else "Hello again",
                "sw": "Habari" if should_greet else "Habari tena",
                "rn": "Amakuru" if should_greet else "Amakuru kandi",
                "ln": "Mbote" if should_greet else "Mbote lisusu",
            }
            greeting = greeting_map.get(language, greeting_map["fr"])
            name_chunk = f" {display_name}" if display_name and should_greet else ""
            return f"{greeting}{name_chunk}. Je suis content de vous retrouver. Qu'est-ce qui vous amène aujourd'hui ?"

        if any(marker in normalized for marker in ["merci", "thank", "asante", "urakoze", "matondo"]):
            return "Avec plaisir. Si vous voulez, nous pouvons continuer calmement et regarder ensemble ce qui vous préoccupe."

        if any(marker in normalized for marker in ["je t aime", "je t'aime", "je vous aime", "je t apprecie", "je t'apprécie"]):
            return (
                "Merci, c'est très gentil. Je suis là pour vous accompagner avec douceur et sérieux. "
                "Si vous voulez, dites-moi ce qui vous préoccupe aujourd'hui et nous allons le regarder calmement ensemble."
            )

        if any(marker in normalized for marker in ["que fais tu", "que peux tu faire", "qui es tu", "presente toi", "présente toi"]):
            if role == "admin":
                return "Je suis PharmiGo. Je peux vous aider à suivre la plateforme, clarifier un flux, repérer un point de risque et proposer la prochaine action utile."
            if role == "pharmacy":
                return "Je suis PharmiGo. Je peux vous aider à suivre votre activité pharmacie, vos stocks, vos ordonnances et vos échanges avec les patients."
            return (
                "Je suis PharmiGo. Parlez-moi simplement de ce dont vous avez besoin, et je vous répondrai avec prudence, clarté et humanité."
            )

        if role == "admin":
            return (
                "Je peux vous aider a suivre la plateforme, clarifier un flux PharmiGo, "
                "et repondre de maniere concise sur les operations ou les usages du systeme."
            )

        if role == "pharmacy":
            return (
                "Je peux vous aider sur la gestion des stocks, les ordonnances, la reponse aux patients "
                "et les usages de la plateforme cote pharmacie."
            )

        return (
            "Je vous écoute. Dites-moi simplement ce que vous voulez aborder, et nous allons avancer calmement."
        )

    def _build_farewell_seed(self, *, question: str, role: str, context: Dict[str, Any]) -> str:
        del role
        language = self._resolve_response_language(question, context)
        display_name = (context.get("display_name") or "").strip()
        name_prefix = f"{display_name}, " if display_name else ""
        lines = {
            "fr": f"{name_prefix}d'accord. Prenez soin de vous. Si vous revenez plus tard, je serai la pour reprendre calmement la conversation ou vous aider a retrouver un medicament.",
            "en": f"{name_prefix}all right. Take good care of yourself. If you come back later, I will be here to continue calmly or help you find what you need.",
            "sw": f"{name_prefix}sawa. Jitunze. Ukirudi baadaye, nitakuwa hapa kuendelea nawe kwa utulivu au kukusaidia kutafuta dawa.",
            "rn": f"{name_prefix}ego. Wiyubare. Ugarutse hanyuma, nzoba nkiri hano kugira tuganire neza canke ngufashe kurondera imiti.",
            "ln": f"{name_prefix}malamu. Batela yo. Soki ozongi sima, nakozala awa mpo tókoba malembe to nasunga yo koluka nkisi.",
        }
        return lines.get(language, lines["fr"])

    def _build_privacy_seed(self, *, question: str, role: str, context: Dict[str, Any]) -> str:
        del role
        language = self._resolve_response_language(question, context)
        is_authenticated = bool(context.get("is_authenticated"))
        display_name = (context.get("display_name") or "").strip()
        name_prefix = f"{display_name}, " if display_name else ""
        if is_authenticated:
            lines = {
                "fr": f"{name_prefix}oui. Ici, dans votre espace connecte, je peux vous accompagner avec plus de precision et de continuite. Vous pouvez me parler plus librement de votre situation, et je repondrai avec tact, prudence et discretion.",
                "en": f"{name_prefix}yes. Here, in your signed-in space, I can guide you with more precision and continuity. You can speak more freely about your situation, and I will answer with tact, caution, and discretion.",
                "sw": f"{name_prefix}ndiyo. Hapa kwenye nafasi yako ukiwa umeingia, ninaweza kukuongoza kwa usahihi zaidi na kwa mwendelezo. Unaweza kueleza hali yako kwa uhuru zaidi, nami nitakujibu kwa busara na tahadhari.",
                "rn": f"{name_prefix}ego. Aha mu mwanya wawe winjiye, ndashobora kugufasha neza kurusha no gukomeza ibiganiro vyacu. Ushobora kumbwira ikibazo cawe mu bwisanzure bwinshi, nanje nkagusubiza mu bwitonzi no mu bwenge.",
                "ln": f"{name_prefix}ee. Awa na esika na yo ya kokota, nakoki kosunga yo na bosikisiki mpe kolanda malamu lisolo na biso. Okoki koyebisa ngai makambo na yo na bonsomi mingi, mpe nakoyanola na bokebi mpe mayele.",
            }
        else:
            lines = {
                "fr": "Oui, si vous voulez que nous parlions de quelque chose de plus prive ou delicat, je vous conseille de vous connecter. Dans votre espace personnel, je pourrai vous accompagner avec plus de precision et garder un meilleur fil de votre situation.",
                "en": "Yes, if you want us to talk about something more private or sensitive, I suggest that you sign in. In your personal space, I will be able to guide you more precisely and keep better continuity.",
                "sw": "Ndiyo, kama unataka tuzungumze kuhusu jambo la faragha au nyeti zaidi, nakushauri uingie kwenye akaunti yako. Ndani ya nafasi yako binafsi, nitaweza kukuongoza kwa usahihi zaidi na kufuatilia hali yako vizuri.",
                "rn": "Ego, nimba ushaka ko tuganira ku kintu cihariye canke c'ibanga kurusha, ndagusavye winjire muri konti yawe. Mu mwanya wawe bwite, nzoshobora kugufasha mu buryo bwimbitse kandi nkomeze neza urutonde rw'ikibazo cawe.",
                "ln": "Ee, soki olingi tólobela likambo ya sekele to ya motema mingi, nakopesa yo toli ya kokota na compte na yo. Na esika na yo moko, nakoki kosalisa yo na bosikisiki mpe kolanda malamu makambo na yo.",
            }
        return lines.get(language, lines["fr"])

    def _build_connection_seed(self, *, question: str, role: str, context: Dict[str, Any]) -> str:
        del role
        language = self._resolve_response_language(question, context)
        is_authenticated = bool(context.get("is_authenticated"))
        display_name = (context.get("display_name") or "").strip()
        name_prefix = f"{display_name}, " if display_name else ""
        if is_authenticated:
            lines = {
                "fr": f"{name_prefix}vous etes deja dans votre espace connecte. Nous pouvons donc continuer plus sereinement et de maniere plus personnelle si vous voulez me parler de votre situation.",
                "en": f"{name_prefix}you are already in your signed-in space. We can continue more calmly and more personally if you want to talk about your situation.",
                "sw": f"{name_prefix}tayari uko kwenye nafasi yako ukiwa umeingia. Tunaweza kuendelea kwa utulivu zaidi na kwa undani zaidi ukitaka kuzungumza kuhusu hali yako.",
                "rn": f"{name_prefix}muri muri konti yanyu yinjiyemwo. Turashobora kubandanya tuvugana neza kurusha no mu buryo bwihariye nimba mushaka kumbwira ibijanye n'ubuzima bwanyu.",
                "ln": f"{name_prefix}ozali deja na esika na yo ya kokota. Tokoki kokoba malembe mpe na lolenge ya moto na moto soki olingi koyebisa ngai likambo na yo.",
            }
        else:
            lines = {
                "fr": "Tres bonne idee. Une fois connecte, je pourrai mieux garder le fil de votre situation et vous accompagner de facon plus precise si vous voulez parler d'un sujet personnel ou sensible.",
                "en": "That is a very good idea. Once you are signed in, I will be able to keep better continuity and support you more precisely if you want to discuss something personal or sensitive.",
                "sw": "Hilo ni wazo zuri sana. Ukishaingia, nitaweza kufuatilia hali yako vizuri zaidi na kukuongoza kwa usahihi zaidi ikiwa unataka kuzungumza kuhusu jambo la kibinafsi au nyeti.",
                "rn": "Ni iciyumviro ciza cane. Nimwaba mwinjiye, nzoshobora gukurikira neza uko mwifashe no kubafasha mu buryo bwimbitse nimba mushaka kuganira ku kintu cihariye canke c'ibanga.",
                "ln": "Ezali likanisi malamu mingi. Soki okoti, nakokoka kolanda malamu makambo na yo mpe kosalisa yo na bosikisiki soki olingi kolobela likambo ya moto na moto to ya sekele.",
            }
        return lines.get(language, lines["fr"])

    @staticmethod
    def _detect_language(question: str) -> str:
        lowered = normalize_text(question or "")
        if not lowered:
            return "fr"
        if any(marker in lowered for marker in [
            "how are you", "hello", "good evening", "good morning", "private", "confidential",
            "bye", "goodbye", "thank you", "please", "medicine", "stress", "sleep",
            "i feel", "i am sick", "can you help me", "see you later",
        ]):
            return "en"
        if any(marker in lowered for marker in [
            "habari", "jambo", "asante", "dawa", "kwaheri", "tafadhali", "naumwa",
            "ninaumwa", "afya", "usingizi", "msongo", "shinikizo", "kisukari",
        ]):
            return "sw"
        if any(marker in lowered for marker in [
            "amakuru", "urakoze", "mwaramutse", "ndwaye", "ububabare", "murakoze",
            "nsezera", "ubuzima", "ingwara", "umunaniro", "umuvuduko", "igisukari",
        ]):
            return "rn"
        if any(marker in lowered for marker in [
            "mbote", "matondo", "nkisi", "malamu", "nazali", "nazali kobela",
            "tokomonana", "bokono", "motema pasi", "ngai nazali na mpasi",
        ]):
            return "ln"
        return "fr"

    def _resolve_response_language(self, question: str, context: Dict[str, Any]) -> str:
        preferred_language = (context.get("preferred_language") or "").strip().lower()
        if preferred_language in {"fr", "en", "rn", "sw", "ln"}:
            return preferred_language
        return self._detect_language(question)

    def _answer_health_question(self, question: str, role: str, context: Dict[str, Any]) -> str:
        if not self._looks_like_health_question(question):
            return ""

        normalized = normalize_text(question)
        category = "general"
        if any(marker in normalized for marker in ["chronique", "chronic", "depression", "dépression", "espoir", "desespoir", "désespoir", "lassitude"]):
            category = "chronic_support"
        elif any(marker in normalized for marker in ["souffr", "soufr", "pas bien", "je me sens mal", "je ne me sens pas bien", "fatigue", "faible", "angoisse"]):
            category = "distress"
        if any(marker in normalized for marker in ["enceinte", "grossesse", "allait"]):
            category = "pregnancy"
        elif any(marker in normalized for marker in ["enfant", "bebe", "bébé", "nourrisson"]):
            category = "child"
        elif any(marker in normalized for marker in ["effet secondaire", "effets secondaires", "reaction", "réaction", "allerg"]):
            category = "side_effect"
        elif any(marker in normalized for marker in ["interaction", "associer", "combiner", "avec"]):
            category = "interaction"
        elif any(marker in normalized for marker in ["dose", "dosage", "combien", "prise", "prendre"]):
            category = "dosage"
        elif any(marker in normalized for marker in ["diabet", "hypertension", "hypertendu", "asthme", "asthmatique"]):
            category = "chronic_lifestyle"
        elif any(marker in normalized for marker in ["sommeil", "insomnie", "stress", "stressé", "stresse", "anxieux", "anxieuse"]):
            category = "wellbeing"
        elif any(marker in normalized for marker in ["manger", "alimentation", "nourriture", "regime", "régime"]):
            category = "nutrition"
        elif any(marker in normalized for marker in ["douleur", "fievre", "fièvre", "respirer", "respiration", "vomissement", "convulsion"]):
            category = "symptom"

        return self._build_health_guidance_response(category, role, context)

    def _build_health_guidance_response(self, category: str, role: str, context: Dict[str, Any]) -> str:
        is_authenticated = bool(context.get("is_authenticated"))
        display_name = (context.get("display_name") or "").strip()
        name_prefix = f"{display_name}, " if display_name else ""
        framing = {
            "patient": f"{name_prefix}je suis desole de lire cela. Je peux vous donner une orientation generale prudente, sans poser de diagnostic.",
            "pharmacy": "Je peux proposer une orientation generale prudente, sans remplacer une evaluation clinique.",
            "admin": "Je peux fournir un cadrage prudent de sante, sans valeur de diagnostic individuel.",
        }.get(role, f"{name_prefix}je suis desole de lire cela. Je peux vous donner une orientation generale prudente, sans poser de diagnostic.")

        guidance_map = {
            "distress": (
                "Quand une personne dit qu'elle souffre ou ne se sent pas bien, le plus important est d'identifier ce qui la gene le plus maintenant: douleur, fievre, fatigue importante, difficulte a respirer, vomissements ou autre symptome marquant."
            ),
            "dosage": (
                "Pour une question de dose, le plus sur est de verifier l'ordonnance, l'age, le poids, les autres traitements et le terrain medical avant de confirmer une prise."
            ),
            "side_effect": (
                "Un effet secondaire peut etre banal ou important selon le contexte. Il faut surtout noter quand il a commence, sa gravite et s'il y a eu une nouvelle prise ou une association recente."
            ),
            "pregnancy": (
                "Pendant la grossesse ou l'allaitement, il vaut mieux eviter l'automedication et confirmer chaque medicament avec un professionnel de sante ou une pharmacie qualifiee."
            ),
            "child": (
                "Chez l'enfant, la prudence est plus importante car la dose depend souvent de l'age, du poids et de la forme du produit."
            ),
            "interaction": (
                "Pour une possible interaction, il faut verifier les deux produits exacts, leurs doses, la frequence de prise et le contexte medical avant de conclure."
            ),
            "symptom": (
                "Pour des symptomes, l'intensite, la duree, l'age, les traitements en cours et les antecedents changent beaucoup le niveau de risque."
            ),
            "chronic_support": (
                "Quand une personne vit avec une maladie chronique ou commence a perdre espoir, le plus important est de garder un suivi regulier, de ne pas interrompre ses traitements sans avis professionnel, et de parler clairement de ce qu'elle ressent aujourd'hui."
            ),
            "chronic_lifestyle": (
                "Pour une maladie chronique comme le diabete, l'hypertension ou l'asthme, les habitudes quotidiennes jouent un role important: alimentation adaptee, hydratation, activite physique raisonnable, repos et bonne observance du traitement prescrit."
            ),
            "wellbeing": (
                "Quand le stress, l'insomnie ou la fatigue prennent trop de place, il faut regarder le rythme de sommeil, l'hydratation, les ecrans, les repas, le niveau de tension emotionnelle et les traitements deja pris."
            ),
            "nutrition": (
                "Pour l'alimentation, les conseils changent selon la maladie, l'age et les traitements en cours. Le plus prudent est de donner des repères generaux adaptes a la situation sans remplacer un suivi medical ou nutritionnel."
            ),
            "general": (
                "Sans details cliniques complets, la bonne approche est de rester prudent et de faire confirmer les points sensibles par un professionnel."
            ),
        }
        red_flags_map = {
            "distress": "Signaux d'alerte: difficulte a respirer, douleur thoracique, confusion, faiblesse extreme, convulsion, saignement important ou aggravation rapide.",
            "dosage": "Signaux d'alerte: prise excessive suspectee, confusion sur la dose, somnolence importante, vomissements repetes, difficultes a respirer.",
            "side_effect": "Signaux d'alerte: gonflement du visage, difficulte a respirer, eruption importante, malaise, saignement inhabituel.",
            "pregnancy": "Signaux d'alerte: douleur abdominale forte, saignement, essoufflement, vomissements incoercibles, baisse des mouvements du bebe si la grossesse est avancee.",
            "child": "Signaux d'alerte: difficulte a respirer, forte somnolence, convulsion, refus total de boire, dehydration, fievre mal toleree.",
            "interaction": "Signaux d'alerte: malaise, palpitations, confusion, somnolence extreme, saignement, aggravation rapide apres l'association.",
            "symptom": "Signaux d'alerte: douleur thoracique, gene respiratoire, convulsion, faiblesse d'un cote, confusion, forte dehydration, aggravation rapide.",
            "chronic_support": "Signaux d'alerte: idee suicidaire, impossibilite de manger ou boire, difficulte a respirer, douleur intense, confusion, aggravation nette de l'etat general.",
            "chronic_lifestyle": "Signaux d'alerte: essoufflement inhabituel, malaise, forte faiblesse, douleur thoracique, perte de connaissance, symptomes qui s'aggravent rapidement.",
            "wellbeing": "Signaux d'alerte: pensees suicidaires, angoisse extreme, perte de connaissance, confusion, essoufflement important, douleur thoracique ou impossibilite de fonctionner normalement.",
            "nutrition": "Signaux d'alerte: amaigrissement important, vomissements repetes, dehydration, malaise, hypoglycemie suspectee, aggravation rapide de l'etat general.",
            "general": "Signaux d'alerte: aggravation rapide, detresse respiratoire, douleur intense, alteration de conscience, saignement important.",
        }
        next_step_map = {
            "patient": "Si vous me dites le symptome principal, depuis quand cela dure, l'age de la personne concernee, et si vous avez deja une ordonnance ou un traitement en cours, je peux vous aider a poser la bonne question et voir ensuite s'il faut chercher un medicament, une pharmacie ou un service de soin.",
            "pharmacy": "Le plus prudent est d'encourager une verification clinique ou pharmaceutique detaillee avant de rassurer ou de valider un usage.",
            "admin": "Le bon cadre ici est de pousser une orientation vers un professionnel, avec une communication sobre et non prescriptive.",
        }
        privacy_note = (
            "Comme vous etes connecte, je peux garder un meilleur fil de ce que vous m'expliquez et vous accompagner de facon plus precise."
            if is_authenticated and role == "patient"
            else "Si vous souhaitez en parler de maniere plus personnelle et suivie, vous pouvez vous connecter afin que je vous accompagne avec plus de continuite."
        )

        role_memory = context.get("conversation_memory") or {}
        continuity = role_memory.get("continuity_note") or ""
        chronic_profile = context.get("patient_support_profile") or {}
        parts = [
            framing,
            guidance_map.get(category, guidance_map["general"]),
            red_flags_map.get(category, red_flags_map["general"]),
            next_step_map.get(role, next_step_map["patient"]),
            "Mes conseils restent informatifs et ne remplacent pas l'avis d'un medecin ou d'un pharmacien.",
        ]
        if category == "chronic_support" and chronic_profile.get("possible_chronic_condition"):
            parts.append(
                "J'ai aussi l'impression, a partir de votre parcours PharmiGo, qu'il peut y avoir un suivi au long cours. Si vous le souhaitez, nous pouvons reprendre calmement votre situation et voir ce qui vous pese le plus aujourd'hui."
            )
        if continuity and role == "patient":
            parts.append(f"Contexte conserve: {continuity}")
        if role == "patient":
            parts.append(privacy_note)
        return " ".join(part for part in parts if part)

    def _answer_medicine_lookup(self, medication_names: List[str], role: str, user=None) -> Tuple[str, float]:
        del role

        requested_names = self._prepare_requested_medications(medication_names)

        if not requested_names:
            return (
                "Je n'ai malheureusement trouve aucun medicament correspondant a votre recherche. "
                "N'hesitez pas a uploader votre ordonnance pour que je puisse effectuer une recherche plus approfondie via l'analyse d'image."
            ), 0.78

        sections: List[str] = []
        found_count = 0
        missing_count = 0
        user_latitude, user_longitude = self._get_user_coordinates(user)

        for medication_name in requested_names:
            exact_name, exact_matches = self._find_exact_stock_matches(
                medication_name,
                user_latitude=user_latitude,
                user_longitude=user_longitude,
            )
            if exact_matches:
                found_count += 1
                sections.append(
                    self._format_medication_section(
                        requested_name=medication_name,
                        matched_name=exact_name,
                        matches=exact_matches,
                        exact=True,
                    )
                )
                continue

            suggestion_name, suggested_matches = self._find_similar_stock_matches(
                medication_name,
                user_latitude=user_latitude,
                user_longitude=user_longitude,
            )
            if suggestion_name and suggested_matches:
                found_count += 1
                sections.append(
                    self._format_medication_section(
                        requested_name=medication_name,
                        matched_name=suggestion_name,
                        matches=suggested_matches,
                        exact=False,
                    )
                )
                continue

            missing_count += 1
            sections.append(
                self._format_missing_medication_section(
                    medication_name,
                    self._find_close_stock_names(medication_name),
                )
            )

        if found_count == 0:
            requested_label = ", ".join(requested_names)
            available_stock_snapshot = self._format_available_stock_snapshot()
            return (
                f"J'ai recherche {requested_label} chez les partenaires certifies PharmiGo eligibles. "
                "Je n'ai pas de stock correspondant disponible pour le moment.\n\n"
                f"{available_stock_snapshot}"
            ), 0.8

        summary_parts = [
            f"J'ai trouve {found_count} medicament(s) correspondant a votre demande sur {len(requested_names)} recherche(s)."
        ]
        if missing_count:
            summary_parts.append(f"{missing_count} medicament(s) n'ont pas ete trouves exactement dans les stocks actifs.")
        summary_parts.append("Voici les details, medicament par medicament, avec les pharmacies correspondantes :")
        summary = " ".join(summary_parts)
        confidence = 0.94 if found_count == len(requested_names) else 0.86
        return f"{summary}\n\n" + "\n\n".join(sections), confidence

    def _prepare_requested_medications(self, medication_names: List[str]) -> List[str]:
        prepared_names: List[str] = []
        seen_variants = set()

        for name in medication_names[:10]:
            canonical_name = self._canonicalize_requested_medication(name)
            normalized_canonical = normalize_text(canonical_name)
            if not normalized_canonical or normalized_canonical in seen_variants:
                continue
            if any(self._token_set_ratio(normalized_canonical, seen_name) >= 80 for seen_name in seen_variants):
                continue
            seen_variants.add(normalized_canonical)
            prepared_names.append(canonical_name)

        return prepared_names

    def _canonicalize_requested_medication(self, medication_name: str) -> str:
        learned_name = self._find_learned_medicine_name(medication_name)
        if learned_name:
            return learned_name

        normalized_requested = normalize_text(medication_name)
        for canonical_name, aliases in getattr(self.qa_service, "MEDICATION_ALIASES", {}).items():
            normalized_canonical = normalize_text(canonical_name)
            normalized_aliases = {normalize_text(alias) for alias in aliases}
            if normalized_requested == normalized_canonical or normalized_requested in normalized_aliases:
                return canonical_name

        return medication_name

    @staticmethod
    def _get_user_coordinates(user) -> Tuple[float | None, float | None]:
        profile = getattr(user, "profile", None) if getattr(user, "is_authenticated", False) else None
        return (
            getattr(profile, "latitude", None) if profile else None,
            getattr(profile, "longitude", None) if profile else None,
        )

    def _iter_eligible_partner_stocks(self):
        from apps.prescriptions.models import PharmacyStock as RealPharmacyStock

        stocks = (
            RealPharmacyStock.objects.select_related("pharmacy", "pharmacy__subscription")
            .filter(is_available=True, quantity__gt=0)
            .order_by("pharmacy__name", "medication_name", "dosage")
        )
        return [stock for stock in stocks if self._is_partner_eligible(getattr(stock, "pharmacy", None))]

    @staticmethod
    def _is_partner_eligible(pharmacy) -> bool:
        if pharmacy is None:
            return False
        subscription = getattr(pharmacy, "subscription", None)
        if subscription is None:
            return False

        status = (getattr(subscription, "subscription_status", "") or "").strip().lower()
        trial_active = bool(getattr(subscription, "is_trial_active", False))
        trial_end_date = getattr(subscription, "trial_end_date", None)
        now = timezone.now()

        if status == "active":
            return bool(getattr(pharmacy, "is_verified", False))

        if status == "trial" and trial_active and trial_end_date and now <= trial_end_date:
            return True

        return False

    def _format_available_stock_snapshot(self) -> str:
        visible_stocks = list(self._iter_eligible_partner_stocks()[:8])

        if not visible_stocks:
            return (
                "Je n'ai pas de partenaire certifie disponible dans cette zone pour le moment. "
                "Vous pouvez revenir un peu plus tard ou publier votre ordonnance pour que je poursuive la recherche des qu'un partenaire certifie est disponible."
            )

        lines = ["Stocks actuellement visibles chez les partenaires certifies PharmiGo :"]
        for stock in visible_stocks:
            dosage = f" {stock.dosage}" if stock.dosage else ""
            unit = f" {stock.unit}" if stock.unit else ""
            lines.append(
                f"- {stock.pharmacy.name} (Partenaire Certifie PharmiGo): {stock.medication_name}{dosage} | stock {stock.quantity}{unit} | "
                f"prix {self._format_price(str(stock.price) if stock.price else '')}"
            )
        return "\n".join(lines)

    def _find_learned_medicine_name(self, medication_name: str) -> str:
        from .models import ChatbotLearningData

        requested = normalize_text(medication_name)
        if not requested:
            return ""

        learning_rows = ChatbotLearningData.objects.exclude(corrected_medicine="").order_by("-created_at")[:200]
        best_name = ""
        best_score = 0

        for row in learning_rows:
            for candidate in [row.corrected_medicine, row.detected_medicine, row.original_text]:
                normalized_candidate = normalize_text(candidate or "")
                if not normalized_candidate or not self._is_reasonable_medicine_candidate(candidate or ""):
                    continue
                score = self._token_set_ratio(requested, normalized_candidate)
                if score > best_score:
                    best_score = score
                    best_name = row.corrected_medicine or row.detected_medicine or candidate

        return best_name if best_score >= 70 and self._is_reasonable_medicine_candidate(best_name) else ""

    @staticmethod
    def _is_reasonable_medicine_candidate(candidate: str) -> bool:
        clean_candidate = str(candidate or "").strip()
        if not clean_candidate:
            return False
        if "," in clean_candidate or ";" in clean_candidate or "\n" in clean_candidate:
            return False
        if len(clean_candidate.split()) > 4:
            return False
        return True

    def _search_matching_stocks(
        self,
        medication_name: str,
        *,
        user_latitude: float | None = None,
        user_longitude: float | None = None,
    ) -> List[Dict[str, str]]:
        requested = normalize_text(medication_name)
        if not requested:
            return []

        matches: List[Dict[str, str]] = []
        stocks = self._iter_eligible_partner_stocks()

        for stock in stocks:
            best_score = 0
            for candidate in [stock.medication_name, stock.generic_name or ""]:
                normalized_candidate = normalize_text(candidate)
                if not normalized_candidate:
                    continue
                best_score = max(best_score, self._token_set_ratio(requested, normalized_candidate))

            if best_score >= 72:
                matches.append(
                    self._build_stock_match_payload(
                        stock,
                        medication_name=medication_name,
                        score=best_score,
                        user_latitude=user_latitude,
                        user_longitude=user_longitude,
                    )
                )

        matches.sort(
            key=lambda item: (
                item.get("distance_sort_key", float("inf")),
                -int(item["score"]),
                item["pharmacy_name"].lower(),
            )
        )
        return matches

    def _find_exact_stock_matches(
        self,
        medication_name: str,
        *,
        user_latitude: float | None = None,
        user_longitude: float | None = None,
    ) -> Tuple[str, List[Dict[str, str]]]:
        learned_name = self._find_learned_medicine_name(medication_name)
        search_name = learned_name or medication_name
        requested = normalize_text(search_name)
        if not requested:
            return search_name, []

        alias_candidates = {requested}
        for canonical_name, aliases in getattr(self.qa_service, "MEDICATION_ALIASES", {}).items():
            normalized_canonical = normalize_text(canonical_name)
            normalized_aliases = {normalize_text(alias) for alias in aliases}
            if requested == normalized_canonical or requested in normalized_aliases:
                alias_candidates.add(normalized_canonical)
                alias_candidates.update(normalized_aliases)

        exact_matches: List[Dict[str, str]] = []
        stocks = self._iter_eligible_partner_stocks()

        seen_keys = set()
        for stock in stocks:
            candidates = [
                normalize_text(stock.medication_name or ""),
                normalize_text(stock.generic_name or ""),
            ]
            if not any(candidate in alias_candidates for candidate in candidates if candidate) and not any(
                any(alias in candidate or candidate in alias for alias in alias_candidates) for candidate in candidates if candidate
            ):
                continue

            key = (stock.pharmacy_id, normalize_text(stock.medication_name or ""), normalize_text(stock.dosage or ""))
            if key in seen_keys:
                continue
            seen_keys.add(key)

            exact_matches.append(
                self._build_stock_match_payload(
                    stock,
                    medication_name=search_name,
                    score=100,
                    user_latitude=user_latitude,
                    user_longitude=user_longitude,
                )
            )

        exact_matches.sort(
            key=lambda item: (
                item.get("distance_sort_key", float("inf")),
                item["pharmacy_name"].lower(),
                item.get("medication_name", "").lower(),
            )
        )
        return search_name, exact_matches

    def _find_similar_stock_matches(
        self,
        medication_name: str,
        *,
        user_latitude: float | None = None,
        user_longitude: float | None = None,
    ) -> Tuple[str, List[Dict[str, str]]]:
        requested = normalize_text(medication_name)
        if not requested:
            return "", []

        candidate_names: Dict[str, str] = {}
        for stock in self._iter_eligible_partner_stocks():
            for candidate in [stock.medication_name, stock.generic_name or ""]:
                normalized_candidate = normalize_text(candidate)
                if normalized_candidate:
                    candidate_names[normalized_candidate] = candidate

        best_name = ""
        best_score = 0
        for normalized_candidate, original_candidate in candidate_names.items():
            score = self._token_set_ratio(requested, normalized_candidate)
            if score > best_score:
                best_score = score
                best_name = original_candidate

        if best_score < 72 or not best_name:
            return "", []

        return best_name, self._search_matching_stocks(
            best_name,
            user_latitude=user_latitude,
            user_longitude=user_longitude,
        )

    def _format_stock_response(self, intro: str, matches: List[Dict[str, str]]) -> str:
        lines = [
            f"- {item['pharmacy_name']} - {item['address']}"
            + (f" - dosage {item['dosage']}" if item["dosage"] else "")
            + (f" - {item['quantity']} {item['unit']}" if item["quantity"] else "")
            + (f" - {item['price']}" if item["price"] else "")
            for item in matches[:5]
        ]
        return f"{intro}\n" + "\n".join(lines)

    def _format_medication_section(
        self,
        *,
        requested_name: str,
        matched_name: str,
        matches: List[Dict[str, str]],
        exact: bool,
    ) -> str:
        lines = [f"MEDICAMENT DEMANDE: {requested_name}"]
        if exact:
            lines.append(f"- Nom trouve dans les stocks: {matched_name}")
        else:
            lines.append(
                f"- Desole, je n'ai pas trouve exactement {requested_name}. J'ai cependant trouve un nom tres proche: {matched_name}"
            )

        for index, item in enumerate(matches[:6], start=1):
            lines.extend(
                [
                    f"{index}. Pharmacie: {item['pharmacy_name']} (Partenaire Certifie PharmiGo)",
                    f"   Adresse: {item['address'] or 'Adresse non renseignee'}",
                    f"   Telephone: {item.get('phone_number') or 'Numero non renseigne'}",
                    f"   Produit trouve: {item.get('medication_name') or matched_name}",
                    f"   Dosage: {item['dosage'] or 'Dosage non renseigne'}",
                    f"   Stock: {self._format_stock_quantity(item)}",
                    f"   Prix: {self._format_price(item.get('price', ''))}",
                    f"   Distance estimee: {self._format_distance(item.get('distance_km'))}",
                ]
            )

        return "\n".join(lines)

    def _format_missing_medication_section(self, requested_name: str, close_names: List[str]) -> str:
        lines = [
            f"MEDICAMENT DEMANDE: {requested_name}",
            f"- Desole, je n'ai pas trouve le medicament {requested_name} chez les partenaires certifies PharmiGo pour le moment.",
        ]
        if close_names:
            lines.append("- Noms proches reperes chez les partenaires certifies :")
            lines.extend([f"  • {name}" for name in close_names[:5]])
        else:
            lines.append("- Je n'ai pas de partenaire certifie disponible dans cette zone pour le moment.")
        return "\n".join(lines)

    @staticmethod
    def _format_stock_quantity(item: Dict[str, str]) -> str:
        quantity = (item.get("quantity") or "").strip()
        unit = (item.get("unit") or "").strip()
        if quantity and unit:
            return f"{quantity} {unit}"
        if quantity:
            return quantity
        return "Quantite non renseignee"

    @staticmethod
    def _format_price(price: str) -> str:
        clean_price = (price or "").strip()
        if not clean_price:
            return "Prix non renseigne"
        return clean_price if clean_price.upper().endswith("BIF") else f"{clean_price} BIF"

    @staticmethod
    def _format_distance(distance_km) -> str:
        if distance_km in (None, "", float("inf")):
            return "Distance indisponible"
        try:
            return f"{float(distance_km):.2f} km"
        except (TypeError, ValueError):
            return "Distance indisponible"

    def _find_close_stock_names(self, medication_name: str) -> List[str]:
        requested = normalize_text(medication_name)
        if not requested:
            return []

        candidates: Dict[str, int] = {}
        for stock in self._iter_eligible_partner_stocks():
            for candidate in [stock.medication_name, stock.generic_name or ""]:
                normalized_candidate = normalize_text(candidate)
                if not normalized_candidate:
                    continue
                score = self._token_set_ratio(requested, normalized_candidate)
                if score >= 55 and score > candidates.get(candidate, 0):
                    candidates[candidate] = score

        return [name for name, _score in sorted(candidates.items(), key=lambda item: (-item[1], item[0].lower()))]

    def _build_stock_match_payload(
        self,
        stock,
        *,
        medication_name: str,
        score: int,
        user_latitude: float | None,
        user_longitude: float | None,
    ) -> Dict[str, str]:
        distance_km = self._calculate_distance(
            user_latitude,
            user_longitude,
            getattr(stock.pharmacy, "latitude", None),
            getattr(stock.pharmacy, "longitude", None),
        )
        return {
            "pharmacy_id": str(stock.pharmacy_id),
            "pharmacy_name": stock.pharmacy.name,
            "address": stock.pharmacy.address,
            "phone_number": stock.pharmacy.phone_number or "",
            "medication_name": stock.medication_name or stock.generic_name or medication_name,
            "dosage": stock.dosage or "",
            "quantity": str(stock.quantity),
            "unit": stock.unit or "",
            "price": f"{stock.price}" if stock.price else "",
            "score": str(score),
            "distance_km": distance_km,
            "distance_sort_key": distance_km if distance_km is not None else float("inf"),
        }

    @staticmethod
    def _calculate_distance(
        user_latitude: float | None,
        user_longitude: float | None,
        pharmacy_latitude: float | None,
        pharmacy_longitude: float | None,
    ) -> float | None:
        if None in {user_latitude, user_longitude, pharmacy_latitude, pharmacy_longitude}:
            return None

        radius_km = 6371
        lat1, lon1, lat2, lon2 = map(radians, [user_latitude, user_longitude, pharmacy_latitude, pharmacy_longitude])
        delta_lat = lat2 - lat1
        delta_lon = lon2 - lon1
        a = sin(delta_lat / 2) ** 2 + cos(lat1) * cos(lat2) * sin(delta_lon / 2) ** 2
        return round(radius_km * 2 * atan2(sqrt(a), sqrt(1 - a)), 2)


    def _knowledge_answer(self, model, question, role):
        normalized_question = normalize_text(question)
        entries = model.objects.filter(is_active=True).filter(Q(role_target=role) | Q(role_target="all"))

        best_entry = None
        best_score = 0
        for entry in entries:
            score = self._token_set_ratio(normalized_question, normalize_text(entry.question))
            keywords = [keyword.strip() for keyword in (entry.keywords or "").split() if keyword.strip()]
            keyword_hits = sum(1 for keyword in keywords if normalize_text(keyword) in normalized_question)
            weighted_score = score + (keyword_hits * 8)
            if weighted_score > best_score:
                best_score = weighted_score
                best_entry = entry

        if best_entry and best_score >= 55:
            return best_entry.answer
        return ""

    def _personalize_answer(self, answer, role, context, medication_name=""):
        answer = answer.strip()
        if not answer:
            return ""
        display_name = (context.get("display_name") or "").strip()
        response_style = context.get("response_style") or {}
        preferred_tone = (response_style.get("tone") or "").strip()
        if role == "patient":
            answer = answer.replace("Le patient", "Je").replace("le patient", "je")
            answer = answer.replace("L'utilisateur", "Je").replace("l'utilisateur", "je")
            answer = answer.replace("Vous pouvez", "Je peux").replace("vous pouvez", "je peux")
            answer = answer.replace("Vous devez", "Je dois").replace("vous devez", "je dois")
            answer = answer.replace("Votre ordonnance", "Mon ordonnance").replace("votre ordonnance", "mon ordonnance")
            answer = answer.replace("vos médicaments", "mes médicaments").replace("Vos médicaments", "Mes médicaments")
            if context["pending_confirmations"]:
                answer += " J'ai aussi repéré des médicaments en attente de confirmation dans mon ordonnance."
            if medication_name and "PharmiGo" not in answer and "pharmacie" in answer.lower():
                answer += f" Je me base sur les pharmacies et les stocks réellement enregistrés pour {medication_name}."
            if context.get("conversation_memory", {}).get("visit_count", 0) > 1 and "continuity_note" in context.get("conversation_memory", {}):
                answer += f" {context['conversation_memory']['continuity_note']}"
            if preferred_tone == "reassuring" and "diagnostic" not in normalize_text(answer):
                answer += " Si quelque chose vous inquiete ou s'aggrave, il vaut mieux demander un avis medical rapidement."
            if display_name and not answer.lower().startswith(("bonjour", "salut", "bonsoir")):
                answer = f"{display_name}, {answer[0].lower() + answer[1:]}" if len(answer) > 1 else f"{display_name}, {answer}"
        elif role == "pharmacy":
            answer = answer.replace("Une pharmacie", "Votre pharmacie").replace("La pharmacie", "Votre pharmacie")
            if context["pharmacy_stock"]:
                answer += " Je tiens compte de votre stock, de vos ordonnances publiques et de vos notifications recentes."
            if preferred_tone in {"operational", "direct"}:
                answer += " Je privilegie ici une reponse courte, exploitable et orientee action."
        elif role == "admin":
            answer = answer.replace("Vous pouvez", "Vous pouvez").strip()
            answer = f"{answer} Je garde une vue synthétique: risque, impact et prochaine action."
        else:
            answer = answer.strip()
        return answer

    def _fallback_answer(self, role, context):
        if role == "patient":
            pending = len(context["pending_confirmations"])
            if pending:
                return (
                    f"Je peux vous accompagner pas a pas sur votre sante, votre ordonnance et la recherche de medicaments. "
                    f"Vous avez actuellement {pending} verification(s) en attente si vous voulez que nous les reprenions ensemble."
                )
            return (
                "Je peux vous accompagner sur vos questions de sante generale, votre bien-etre, vos ordonnances "
                "et la recherche de pharmacies quand vous avez besoin d'un medicament."
            )
        if role == "pharmacy":
            return "Je peux vous aider a gerer votre stock, vos ordonnances publiques, vos notifications et vos echanges avec les autres pharmacies, tout en restant clair et operationnel."
        if role == "admin":
            return "Je peux vous aider a suivre le chatbot, l'activite plateforme, les risques operationnels et les prochaines actions a prioriser."
        return (
            "Je suis toujours là pour vous accompagner avec calme et prudence sur vos questions de santé, de bien-être ou de médicaments."
        )

    def safe_fallback_answer(self, question: str, user=None, preferred_language: str | None = None) -> str:
        cleaned_question = (question or "").strip()
        try:
            context = self.context_service.build_context(user)
        except Exception:
            context = {
                "role": "all",
                "is_authenticated": bool(getattr(user, "is_authenticated", False)),
                "display_name": "",
                "pending_confirmations": [],
                "conversation_memory": {},
                "response_style": {},
                "patient_support_profile": {},
            }
        context = self._inject_preferred_language(context, preferred_language)

        role = context["role"] if context.get("role") in {"patient", "pharmacy", "admin"} else "all"

        if self._looks_like_farewell(cleaned_question):
            return self._build_farewell_seed(question=cleaned_question, role=role, context=context)
        if self._looks_like_privacy_request(cleaned_question):
            return self._build_privacy_seed(question=cleaned_question, role=role, context=context)
        if self._looks_like_connection_intent(cleaned_question):
            return self._build_connection_seed(question=cleaned_question, role=role, context=context)
        if self._looks_like_general_conversation(cleaned_question):
            return self._build_general_conversation_seed(question=cleaned_question, role=role, context=context)

        health_answer = self._answer_health_question(cleaned_question, role, context)
        if health_answer:
            return health_answer

        return self._fallback_answer(role, context)

    @staticmethod
    def _token_set_ratio(left: str, right: str) -> int:
        if fuzz is not None:
            return int(fuzz.token_set_ratio(left, right))

        left_tokens = set(left.split())
        right_tokens = set(right.split())
        if not left_tokens and not right_tokens:
            return 100
        if not left_tokens or not right_tokens:
            return 0

        overlap = len(left_tokens & right_tokens)
        coverage = (2 * overlap) / (len(left_tokens) + len(right_tokens))
        text_similarity = SequenceMatcher(None, left, right).ratio()
        return int(max(coverage, text_similarity) * 100)

    def _record_learning(
        self,
        model,
        *,
        user=None,
        original_text="",
        detected_intent="",
        detected_medicine="",
        corrected_medicine="",
        corrected_answer="",
        source="system",
        confidence_before=0.0,
        confidence_after=0.0,
        prescription=None,
    ):
        model.objects.create(
            user=user if getattr(user, "is_authenticated", False) else None,
            original_text=original_text,
            detected_intent=detected_intent,
            detected_medicine=detected_medicine,
            corrected_medicine=corrected_medicine,
            corrected_answer=corrected_answer,
            source=source,
            confidence_before=confidence_before,
            confidence_after=confidence_after,
            prescription=prescription,
        )
