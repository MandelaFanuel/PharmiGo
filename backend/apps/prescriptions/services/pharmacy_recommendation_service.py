from __future__ import annotations

from dataclasses import dataclass
from decimal import Decimal
from difflib import SequenceMatcher
from math import atan2, cos, radians, sin, sqrt
from typing import Iterable

from django.db import transaction

from apps.pharmacies.models import Pharmacy, PharmacySubscription
from apps.pharmigo_chatbot.utils import normalize_text
from apps.prescriptions.models import MedicationExtraction, PharmacyStock, Prescription, PrescriptionRecommendation
from apps.prescriptions.services.qa_service import QAService


@dataclass
class RecommendationContext:
    prescription: Prescription
    user_latitude: float | None = None
    user_longitude: float | None = None


class PharmacyRecommendationService:
    """Build and persist ranked pharmacy recommendations for a prescription."""

    def __init__(self) -> None:
        self.qa_service = QAService()

    def generate_for_prescription(self, prescription: Prescription, user=None) -> dict:
        medications = list(
            prescription.extracted_medications.filter(confirmed=True).order_by("-confidence", "id")
        )
        if not medications:
            return {
                "status": "failed",
                "message": "Aucun médicament confirmé n'est disponible pour lancer la recherche.",
                "recommendations": [],
            }

        context = RecommendationContext(
            prescription=prescription,
            user_latitude=self._coerce_float(getattr(getattr(user, "profile", None), "latitude", None)),
            user_longitude=self._coerce_float(getattr(getattr(user, "profile", None), "longitude", None)),
        )

        recommendations = self._build_recommendations(context, medications)
        persisted = self._persist_recommendations(prescription, recommendations)

        if not persisted:
            return {
                "status": "empty",
                "message": "Aucune pharmacie ne possède actuellement mes médicaments confirmés.",
                "recommendations": [],
            }

        has_complete = any(item["availability"] == "complete" for item in persisted)
        return {
            "status": "ready",
            "message": (
                "J'ai trouvé les pharmacies suivantes qui possèdent mes médicaments."
                if has_complete
                else "Aucune pharmacie ne possède tous mes médicaments. Voici les pharmacies qui en possèdent une partie."
            ),
            "recommendations": persisted,
        }

    def serialize_existing(self, prescription: Prescription) -> list[dict]:
        return [
            {
                "pharmacy_id": recommendation.pharmacy_id,
                "pharmacy_name": recommendation.pharmacy.name,
                "name": recommendation.pharmacy.name,
                "address": recommendation.pharmacy.address,
                "phone": recommendation.pharmacy.phone_number,
                "distance": recommendation.distance_km,
                "distance_km": recommendation.distance_km,
                "availability": recommendation.availability,
                "matched_count": len(recommendation.matched_items or []),
                "missing_count": len(recommendation.missing_items or []),
                "matched_items": recommendation.matched_items or [],
                "missing_items": recommendation.missing_items or [],
                "available_medications": recommendation.matched_items or [],
                "missing_medications": recommendation.missing_items or [],
                "match_score": recommendation.score,
                "estimated_total_price": float(recommendation.estimated_total_price),
                "estimated_price": float(recommendation.estimated_total_price),
                "score": recommendation.score,
            }
            for recommendation in prescription.recommendations.select_related("pharmacy").all()
        ]

    def _build_recommendations(
        self,
        context: RecommendationContext,
        medications: Iterable[MedicationExtraction],
    ) -> list[dict]:
        results: list[dict] = []
        medication_list = list(medications)
        pharmacies = Pharmacy.objects.all().order_by("name")

        for pharmacy in pharmacies:
            if getattr(pharmacy, "is_active", True) is False:
                continue
            if not self._subscription_is_eligible(pharmacy):
                continue

            matched_items: list[dict] = []
            missing_items: list[dict] = []
            total_price = Decimal("0.00")
            freshest_update = None

            for medication in medication_list:
                stock = self._find_matching_stock(pharmacy, medication)
                if stock is None or stock.quantity < max(1, medication.quantity) or not stock.is_available:
                    missing_items.append(
                        {
                            "medicine": medication.name,
                            "dosage": medication.dosage,
                            "form": medication.form,
                            "quantity": medication.quantity,
                            "posology": medication.posology,
                        }
                    )
                    continue

                freshest_update = stock.last_updated if freshest_update is None else max(freshest_update, stock.last_updated)
                price = stock.price or Decimal("0.00")
                total_price += price
                matched_items.append(
                    {
                        "medicine": medication.name,
                        "requested_medicine": medication.name,
                        "matched_name": stock.medication_name,
                        "generic_name": stock.generic_name,
                        "dosage": medication.dosage,
                        "matched_dosage": stock.dosage,
                        "form": medication.form,
                        "quantity": medication.quantity,
                        "posology": medication.posology,
                        "price": float(price),
                        "quantity_available": stock.quantity,
                        "unit": stock.unit,
                        "stock_last_updated": stock.last_updated.isoformat() if stock.last_updated else None,
                    }
                )

            if not matched_items:
                continue

            distance_km = self._calculate_distance(
                context.user_latitude,
                context.user_longitude,
                pharmacy.latitude,
                pharmacy.longitude,
            )
            availability = "complete" if not missing_items else "partial"
            matched_count = len(matched_items)
            missing_count = len(missing_items)
            score = self._score_recommendation(
                availability=availability,
                matched_count=matched_count,
                total_count=len(medication_list),
                distance_km=distance_km,
                total_price=total_price,
                freshest_update=freshest_update.timestamp() if freshest_update else 0.0,
            )

            results.append(
                {
                    "pharmacy": pharmacy,
                    "availability": availability,
                    "matched_count": matched_count,
                    "missing_count": missing_count,
                    "matched_items": matched_items,
                    "missing_items": missing_items,
                    "distance_km": distance_km,
                    "estimated_total_price": total_price,
                    "score": score,
                }
            )

        results.sort(
            key=lambda item: (
                0 if item["availability"] == "complete" else 1,
                -(item["matched_count"] / max(1, len(medication_list))),
                item["distance_km"] if item["distance_km"] is not None else float("inf"),
                float(item["estimated_total_price"]),
                -item["score"],
            )
        )
        return results[:10]

    def _persist_recommendations(self, prescription: Prescription, recommendations: list[dict]) -> list[dict]:
        with transaction.atomic():
            prescription.recommendations.all().delete()
            created: list[dict] = []
            for item in recommendations:
                record = PrescriptionRecommendation.objects.create(
                    prescription=prescription,
                    pharmacy=item["pharmacy"],
                    availability=item["availability"],
                    matched_items=item["matched_items"],
                    missing_items=item["missing_items"],
                    estimated_total_price=item["estimated_total_price"],
                    distance_km=item["distance_km"],
                    score=item["score"],
                )
                created.append(
                    {
                        "pharmacy_id": record.pharmacy_id,
                        "pharmacy_name": record.pharmacy.name,
                        "name": record.pharmacy.name,
                        "address": record.pharmacy.address,
                        "phone": record.pharmacy.phone_number,
                        "distance": record.distance_km,
                        "distance_km": record.distance_km,
                        "availability": record.availability,
                        "matched_count": len(record.matched_items or []),
                        "missing_count": len(record.missing_items or []),
                        "matched_items": record.matched_items or [],
                        "missing_items": record.missing_items or [],
                        "available_medications": record.matched_items or [],
                        "missing_medications": record.missing_items or [],
                        "match_score": record.score,
                        "estimated_total_price": float(record.estimated_total_price),
                        "estimated_price": float(record.estimated_total_price),
                        "score": record.score,
                    }
                )
            return created

    def _find_matching_stock(self, pharmacy: Pharmacy, medication: MedicationExtraction) -> PharmacyStock | None:
        medication_candidates = self._medication_candidates(medication)
        candidate_stocks = PharmacyStock.objects.filter(
            pharmacy=pharmacy,
            is_available=True,
            quantity__gt=0,
        ).order_by("-last_updated")

        best_stock = None
        best_score = 0.0
        for stock in candidate_stocks:
            score = self._stock_match_score(medication, medication_candidates, stock)
            if score > best_score:
                best_score = score
                best_stock = stock

        return best_stock if best_stock is not None and best_score >= 0.58 else None

    def _medication_candidates(self, medication: MedicationExtraction) -> set[str]:
        candidates = {
            normalize_text(medication.name),
            normalize_text(medication.generic_name or ""),
        }
        base_names = {candidate for candidate in candidates if candidate}

        for candidate in list(base_names):
            for canonical_name, aliases in getattr(self.qa_service, "MEDICATION_ALIASES", {}).items():
                normalized_canonical = normalize_text(canonical_name)
                normalized_aliases = {normalize_text(alias) for alias in aliases}
                if candidate == normalized_canonical or candidate in normalized_aliases:
                    candidates.add(normalized_canonical)
                    candidates.update(normalized_aliases)

        return {candidate for candidate in candidates if candidate}

    def _stock_match_score(
        self,
        medication: MedicationExtraction,
        medication_candidates: set[str],
        stock: PharmacyStock,
    ) -> float:
        stock_candidates = {
            normalize_text(stock.medication_name),
            normalize_text(stock.generic_name or ""),
        }
        stock_candidates = {candidate for candidate in stock_candidates if candidate}
        if not stock_candidates:
            return 0.0

        name_score = max(
            (
                self._similarity(med_candidate, stock_candidate)
                for med_candidate in medication_candidates
                for stock_candidate in stock_candidates
            ),
            default=0.0,
        )

        if medication_candidates & stock_candidates:
            name_score = max(name_score, 1.0)

        if medication_candidates and stock_candidates:
            alias_overlap = any(
                med_candidate in stock_candidate or stock_candidate in med_candidate
                for med_candidate in medication_candidates
                for stock_candidate in stock_candidates
            )
            if alias_overlap:
                name_score = max(name_score, 0.86)

        dosage_score = self._field_similarity(medication.dosage, stock.dosage)
        form_score = self._field_similarity(medication.form or medication.unit, stock.unit)

        weighted_score = name_score
        if dosage_score:
            weighted_score += 0.22 * dosage_score
        if form_score:
            weighted_score += 0.08 * form_score
        return weighted_score

    def _subscription_is_eligible(self, pharmacy: Pharmacy) -> bool:
        try:
            subscription = PharmacySubscription.objects.get(pharmacy=pharmacy)
        except PharmacySubscription.DoesNotExist:
            from pharmigo.api import ensure_subscription_for_pharmacy

            subscription = ensure_subscription_for_pharmacy(pharmacy)
            if subscription is None:
                return False
        return subscription.is_active()

    @staticmethod
    def _score_recommendation(
        *,
        availability: str,
        matched_count: int,
        total_count: int,
        distance_km: float | None,
        total_price: Decimal,
        freshest_update: float,
    ) -> float:
        availability_bonus = 1.0 if availability == "complete" else 0.55
        coverage = matched_count / max(1, total_count)
        distance_component = 1 / (1 + (distance_km or 12))
        price_component = 1 / (1 + float(total_price or 0))
        freshness_component = freshest_update / 10_000_000_000 if freshest_update else 0.0
        return round(
            (availability_bonus * 0.45)
            + (coverage * 0.3)
            + (distance_component * 0.15)
            + (price_component * 0.05)
            + (freshness_component * 0.05),
            4,
        )

    @staticmethod
    def _similarity(left: str, right: str) -> float:
        if left == right:
            return 1.0
        left_tokens = set(left.split())
        right_tokens = set(right.split())
        if not left_tokens or not right_tokens:
            return 0.0
        overlap = len(left_tokens & right_tokens) / max(len(left_tokens), len(right_tokens))
        text_ratio = 0.0
        if left in right or right in left:
            text_ratio = 0.9
        sequence_ratio = SequenceMatcher(None, left, right).ratio()
        return max(overlap, text_ratio, sequence_ratio)

    @staticmethod
    def _field_similarity(left: str | None, right: str | None) -> float:
        normalized_left = normalize_text(left or "")
        normalized_right = normalize_text(right or "")
        if not normalized_left or not normalized_right:
            return 0.0
        if normalized_left == normalized_right:
            return 1.0
        return SequenceMatcher(None, normalized_left, normalized_right).ratio()

    @staticmethod
    def _coerce_float(value) -> float | None:
        try:
            if value in (None, ""):
                return None
            return float(value)
        except (TypeError, ValueError):
            return None

    def _calculate_distance(
        self,
        user_lat: float | None,
        user_lon: float | None,
        pharmacy_lat: float | None,
        pharmacy_lon: float | None,
    ) -> float | None:
        if None in {user_lat, user_lon, pharmacy_lat, pharmacy_lon}:
            return None

        radius = 6371
        lat1, lon1, lat2, lon2 = map(radians, [user_lat, user_lon, pharmacy_lat, pharmacy_lon])
        dlat = lat2 - lat1
        dlon = lon2 - lon1
        a = sin(dlat / 2) ** 2 + cos(lat1) * cos(lat2) * sin(dlon / 2) ** 2
        return round(radius * 2 * atan2(sqrt(a), sqrt(1 - a)), 2)
