import logging
from difflib import SequenceMatcher
from typing import Iterable

from apps.prescriptions.models import PharmacyStock

from .gemini_vision_service import GeminiVisionService
from .medication_extractor import MedicationExtractor
from .ocr_service import OCRService

logger = logging.getLogger(__name__)

try:
    from Levenshtein import ratio as levenshtein_ratio
except ImportError:  # pragma: no cover
    levenshtein_ratio = None


class PrescriptionAnalysisService:
    """Hybrid prescription analysis service: OCR + Gemini Vision + fuzzy matching."""

    def __init__(self):
        self.ocr_service = OCRService()
        self.gemini_service = GeminiVisionService()
        self.extractor = MedicationExtractor()

    def analyze_prescription(self, image_path: str | None = None, text_input: str = "") -> dict:
        logger.info(
            "[ANALYSIS] service=PrescriptionAnalysisService image_path=%s text_input_length=%s gemini_enabled=%s gemini_key_present=%s gemini_model=%s",
            image_path,
            len(text_input or ""),
            self.gemini_service.enabled,
            bool(self.gemini_service.api_key),
            self.gemini_service.model,
        )
        ocr_result = {"success": bool(text_input), "text": text_input, "confidence": 1.0 if text_input else 0.0}
        if image_path:
            ocr_result = self.ocr_service.analyze_with_both_engines(image_path)

        gemini_result = {"success": False, "text": "", "confidence": 0.0, "medications": []}
        if image_path:
            gemini_result = self.gemini_service.analyze_prescription(image_path)
        logger.info(
            "[GEMINI] response received success=%s error=%s raw_text_length=%s meds=%s",
            gemini_result.get("success"),
            gemini_result.get("error"),
            len(str(gemini_result.get("text") or "")),
            len(gemini_result.get("medications") or []),
        )

        raw_ocr_text = str(ocr_result.get("text") or text_input or "").strip()
        gemini_text = str(gemini_result.get("text") or "").strip()
        fallback_text = gemini_text or raw_ocr_text
        extracted_from_ocr = self.extractor.extract_medications(fallback_text)
        extracted_from_gemini = self._normalize_gemini_medications(gemini_result.get("medications") or [])
        if not extracted_from_ocr and gemini_text:
            extracted_from_ocr = self.extractor.extract_medications(gemini_text)

        merged_analysis = self._merge_candidates(extracted_from_ocr, extracted_from_gemini)
        display_text, display_text_source = self._build_display_text(raw_ocr_text, gemini_result, merged_analysis)
        global_score = self._compute_global_score(merged_analysis, ocr_result, gemini_result)
        needs_confirmation = global_score < 0.9 or any(item["confidence"] < 0.8 for item in merged_analysis)
        gemini_succeeded = bool(gemini_result.get("success"))

        if not gemini_succeeded and not merged_analysis:
            needs_confirmation = True

        if not gemini_succeeded:
            message = "Je n'ai pas pu analyser correctement l'ordonnance. Je peux confirmer les médicaments manuellement."
        elif needs_confirmation:
            message = "L'analyse est incomplète, pouvez-vous confirmer les éléments suivants ?"
        else:
            message = "L'analyse est terminée. Je peux maintenant rechercher les pharmacies disponibles."

        if gemini_succeeded and (gemini_text or gemini_result.get("raw_response")) and not merged_analysis:
            message = "J'ai extrait du texte, mais je dois confirmer mes médicaments manuellement."

        logger.info(
            "[ANALYSIS] extracted medications count=%s global_score=%s needs_confirmation=%s final_message=%s",
            len(merged_analysis),
            global_score,
            needs_confirmation,
            message,
        )

        return {
            "status": "success",
            "data": {
                "analysis": merged_analysis,
                "global_score": global_score,
                "needs_confirmation": needs_confirmation,
            },
            "ocr": ocr_result,
            "gemini": gemini_result,
            "raw_text": display_text,
            "raw_text_source": display_text_source,
            "message": message,
        }

    def _normalize_gemini_medications(self, items: Iterable[dict]) -> list[dict]:
        normalized = []
        for item in items:
            if not isinstance(item, dict):
                continue
            name = str(item.get("medicine_name") or item.get("name") or item.get("raw_text") or "").strip()
            if not name:
                continue
            normalized.append(
                {
                    "name": name,
                    "generic_name": None,
                    "dosage": str(item.get("dosage") or "").strip() or None,
                    "quantity": self._normalize_quantity(item.get("quantity")),
                    "unit": str(item.get("form") or "comprimés").strip() or "comprimés",
                    "confidence": self._coerce_float(item.get("confidence"), 0.78),
                    "confirmed": False,
                    "alternatives": [],
                    "requires_prescription": True,
                    "needs_review": bool(item.get("needs_confirmation", False)) or self._coerce_float(item.get("confidence"), 0.78) < 0.9,
                    "posology": str(item.get("posology") or "").strip() or None,
                }
            )
        return normalized

    def _merge_candidates(self, ocr_items: list[dict], gemini_items: list[dict]) -> list[dict]:
        merged: list[dict] = []
        remaining_ocr = ocr_items.copy()

        for gemini_item in gemini_items:
            matched_ocr = self._pop_best_match(gemini_item["name"], remaining_ocr)
            detected_name = matched_ocr["name"] if matched_ocr else gemini_item["name"]
            fuzzy_match = self._match_known_medicine(gemini_item["name"])
            corrected_name = fuzzy_match["corrected_name"] or gemini_item["name"]
            dosage = gemini_item.get("dosage") or (matched_ocr.get("dosage") if matched_ocr else None)
            confidence = min(
                0.99,
                (
                    gemini_item.get("confidence", 0.0) * 0.55
                    + (matched_ocr.get("confidence", 0.0) if matched_ocr else 0.0) * 0.2
                    + fuzzy_match["match_score"] * 0.25
                ),
            )
            merged.append(
                {
                    "detected_name": detected_name,
                    "corrected_name": corrected_name,
                    "name": corrected_name,
                    "generic_name": matched_ocr.get("generic_name") if matched_ocr else None,
                    "dosage": dosage,
                    "form": gemini_item.get("unit") or (matched_ocr.get("unit") if matched_ocr else "comprimés"),
                    "unit": gemini_item.get("unit") or (matched_ocr.get("unit") if matched_ocr else "comprimés"),
                    "posology": gemini_item.get("posology"),
                    "quantity": matched_ocr.get("quantity") if matched_ocr else 1,
                    "confidence": round(confidence, 2),
                    "needs_review": confidence < 0.9,
                    "requires_prescription": True,
                }
            )

        for ocr_item in remaining_ocr:
            fuzzy_match = self._match_known_medicine(ocr_item["name"])
            confidence = min(0.92, ocr_item.get("confidence", 0.0) * 0.65 + fuzzy_match["match_score"] * 0.35)
            merged.append(
                {
                    "detected_name": ocr_item["name"],
                    "corrected_name": fuzzy_match["corrected_name"] or ocr_item["name"],
                    "name": fuzzy_match["corrected_name"] or ocr_item["name"],
                    "generic_name": ocr_item.get("generic_name"),
                    "dosage": ocr_item.get("dosage"),
                    "form": ocr_item.get("unit") or "comprimés",
                    "unit": ocr_item.get("unit") or "comprimés",
                    "posology": None,
                    "quantity": ocr_item.get("quantity") or 1,
                    "confidence": round(confidence, 2),
                    "needs_review": confidence < 0.9,
                    "requires_prescription": True,
                }
            )

        deduped = []
        seen = set()
        for item in merged:
            key = (item["corrected_name"].lower(), item.get("dosage") or "")
            if key in seen:
                continue
            seen.add(key)
            deduped.append(item)
        deduped.sort(key=lambda item: item["confidence"], reverse=True)
        return deduped

    def _pop_best_match(self, reference_name: str, candidates: list[dict]) -> dict | None:
        best_index = None
        best_score = 0.0
        for index, candidate in enumerate(candidates):
            score = self._similarity(reference_name, candidate.get("name", ""))
            if score > best_score:
                best_score = score
                best_index = index
        if best_index is not None and best_score >= 0.72:
            return candidates.pop(best_index)
        return None

    def _match_known_medicine(self, name: str) -> dict:
        vocab = set(self.extractor.medication_db.get("common_medications", []))
        vocab.update(
            item
            for item in PharmacyStock.objects.exclude(medication_name__isnull=True)
            .exclude(medication_name__exact="")
            .values_list("medication_name", flat=True)
        )
        best_name = None
        best_score = 0.0
        for candidate in vocab:
            score = self._similarity(name, candidate)
            if score > best_score:
                best_score = score
                best_name = candidate
        return {
            "corrected_name": self._titleize(best_name) if best_name and best_score >= 0.78 else self._titleize(name),
            "match_score": best_score,
        }

    def _compute_global_score(self, analysis: list[dict], ocr_result: dict, gemini_result: dict) -> float:
        if not analysis:
            return max(self._coerce_float(ocr_result.get("confidence")), self._coerce_float(gemini_result.get("confidence"))) * 0.5
        average_item_confidence = sum(item["confidence"] for item in analysis) / len(analysis)
        ocr_confidence = self._coerce_float(ocr_result.get("confidence"))
        gemini_confidence = self._coerce_float(gemini_result.get("confidence"))
        blended = average_item_confidence * 0.7 + max(ocr_confidence, gemini_confidence) * 0.3
        return round(min(blended, 0.99), 2)

    def _build_display_text(self, raw_ocr_text: str, gemini_result: dict, analysis: list[dict]) -> tuple[str, str | None]:
        gemini_text = str(gemini_result.get("text") or "").strip()
        gemini_success = bool(gemini_result.get("success"))
        if gemini_success and gemini_text and self._looks_readable(gemini_text):
            return gemini_text, "gemini"
        if gemini_success and analysis:
            lines = []
            for item in analysis:
                details = [item["corrected_name"]]
                if item.get("dosage"):
                    details.append(item["dosage"])
                if item.get("posology"):
                    details.append(item["posology"])
                lines.append(" - ".join(details))
            return "\n".join(lines), "analysis"
        if gemini_success and gemini_text:
            return gemini_text, "gemini"
        if not analysis:
            return "", None
        lines = []
        for item in analysis:
            details = [item["corrected_name"]]
            if item.get("dosage"):
                details.append(item["dosage"])
            if item.get("posology"):
                details.append(item["posology"])
            lines.append(" - ".join(details))
        return "\n".join(lines), "analysis"

    def _looks_readable(self, text: str) -> bool:
        alpha = sum(char.isalpha() for char in text)
        weird = sum(char in {"�", "?", "<", ">"} for char in text)
        return bool(text.strip()) and alpha >= 10 and weird <= max(2, len(text) // 40)

    def _similarity(self, left: str, right: str) -> float:
        left = (left or "").lower().strip()
        right = (right or "").lower().strip()
        if not left or not right:
            return 0.0
        if levenshtein_ratio is not None:
            return float(levenshtein_ratio(left, right))
        return SequenceMatcher(None, left, right).ratio()

    def _coerce_float(self, value, default: float = 0.0) -> float:
        try:
            return float(value)
        except (TypeError, ValueError):
            return default

    def _normalize_quantity(self, value) -> int:
        if value in (None, ""):
            return 1
        try:
            return max(1, int(float(value)))
        except (TypeError, ValueError):
            return 1

    def _titleize(self, value: str | None) -> str | None:
        if not value:
            return None
        return " ".join(part[:1].upper() + part[1:] for part in value.split())
