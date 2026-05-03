import base64
import io
import json
import logging
import os
import time
from urllib import error, request

from django.conf import settings
from PIL import Image, ImageOps

from .json_utils import ensure_json_serializable

logger = logging.getLogger(__name__)


class GeminiVisionService:
    """Online Gemini Vision service for prescription analysis."""

    def __init__(self):
        self.api_key = getattr(settings, "GEMINI_API_KEY", "")
        self.enabled = bool(getattr(settings, "GEMINI_ENABLED", True))
        self.model = self._normalize_model_name(getattr(settings, "GEMINI_MODEL", "gemini-2.5-flash"))
        self.fallback_models = ["gemini-2.5-flash", "gemini-2.0-flash", "gemini-flash-lite-latest"]
        self.request_timeout_seconds = 40.0
        self.available = self.enabled and bool(self.api_key)

    def analyze_prescription(self, image_path: str) -> dict:
        started_at = time.perf_counter()
        if not self.available:
            return {
                "success": False,
                "error": "Gemini is disabled or API key is missing.",
                "medications": [],
                "text": "",
                "confidence": 0.0,
                "raw_response": {},
                "response_time_ms": 0,
                "image_sent": False,
            }

        try:
            prepared_image, image_meta = self._prepare_image(image_path)
        except Exception as exc:
            logger.warning("Gemini image preparation failed: %s", exc)
            return {
                "success": False,
                "error": f"Image preparation failed: {exc}",
                "medications": [],
                "text": "",
                "confidence": 0.0,
                "raw_response": {},
                "response_time_ms": int((time.perf_counter() - started_at) * 1000),
                "image_sent": False,
                "image_meta": {},
            }

        logger.info(
            "Gemini request starting",
            extra={
                "gemini_model": self.model,
                "image_path": image_path,
                "image_sent": True,
                "image_meta": image_meta,
            },
        )

        payload = {
            "contents": [
                {
                    "parts": [
                        {"text": self._prompt()},
                        {
                            "inline_data": {
                                "mime_type": "image/jpeg",
                                "data": prepared_image,
                            }
                        },
                    ]
                }
            ],
            "generationConfig": {
                "temperature": 0.1,
                "responseMimeType": "application/json",
                "maxOutputTokens": 2048,
                "thinkingConfig": {
                    "thinkingBudget": 0,
                },
            },
        }

        try:
            raw_response, used_model = self._generate_content(payload, image_path, image_meta)
        except error.HTTPError as exc:
            try:
                error_body = exc.read().decode("utf-8", errors="ignore")
            except Exception:
                error_body = ""
            logger.warning("Gemini HTTP error %s: %s", exc.code, error_body[:4000] or exc)
            return self._failure(
                f"Gemini HTTP error: {exc.code} {error_body[:500]}".strip(),
                response_time_ms=int((time.perf_counter() - started_at) * 1000),
                image_sent=True,
                image_meta=image_meta,
            )
        except Exception as exc:
            logger.warning("Gemini request failed: %s", exc)
            return self._failure(
                str(exc),
                response_time_ms=int((time.perf_counter() - started_at) * 1000),
                image_sent=True,
                image_meta=image_meta,
            )

        response_time_ms = int((time.perf_counter() - started_at) * 1000)
        logger.info(
            "Gemini prescription analysis completed",
            extra={
                "gemini_model": used_model,
                "response_time_ms": response_time_ms,
                "image_path": image_path,
                "image_sent": True,
                "image_meta": image_meta,
            },
        )
        logger.info("Gemini raw response: %s", json.dumps(raw_response, ensure_ascii=False)[:4000])

        content = self._extract_text_content(raw_response)
        parsed_json = self._parse_json_payload(content)
        medications = self._normalize_medicines(parsed_json.get("medicines") or parsed_json.get("medications") or [])
        raw_text = str(parsed_json.get("raw_text_detected") or parsed_json.get("raw_text") or "").strip()
        doctor = str(parsed_json.get("doctor_or_center") or "").strip() or None
        patient_name = str(parsed_json.get("patient_name") or "").strip() or None
        message = str(parsed_json.get("message_for_patient") or "").strip()
        global_confidence = self._coerce_float(parsed_json.get("global_confidence"), 0.0)
        if global_confidence <= 0 and medications:
            global_confidence = sum(item["confidence"] for item in medications) / len(medications)

        result = {
            "success": True,
            "text": raw_text,
            "medications": medications,
            "confidence": round(global_confidence, 2),
            "doctor_or_center": doctor,
            "patient_name": patient_name,
            "message_for_patient": message,
            "needs_manual_confirmation": bool(parsed_json.get("needs_manual_confirmation", True)),
            "uncertain_parts": parsed_json.get("uncertain_parts") or [],
            "is_prescription": bool(parsed_json.get("is_prescription", True)),
            "raw_response": raw_response,
            "model_used": used_model,
            "response_time_ms": response_time_ms,
            "image_sent": True,
            "image_meta": image_meta,
        }
        try:
            return ensure_json_serializable(result)
        except Exception as exc:
            logger.warning("Serialization error: %s", exc)
            return self._failure(f"Serialization error: {exc}", response_time_ms=response_time_ms, image_sent=True, image_meta=image_meta)

    def _prepare_image(self, image_path: str) -> tuple[str, dict]:
        with Image.open(image_path) as image:
            image = ImageOps.exif_transpose(image)
            original_width, original_height = image.width, image.height
            original_mode = image.mode
            if image.mode not in ("RGB", "L"):
                image = image.convert("RGB")
            max_width = 1280
            if image.width > max_width:
                ratio = max_width / image.width
                image = image.resize((max_width, int(image.height * ratio)), Image.LANCZOS)
            if image.mode != "RGB":
                image = image.convert("RGB")
            output = io.BytesIO()
            image.save(output, format="JPEG", quality=88, optimize=True)
        payload_bytes = output.getvalue()
        return base64.b64encode(payload_bytes).decode("utf-8"), {
            "original_width": original_width,
            "original_height": original_height,
            "prepared_width": image.width,
            "prepared_height": image.height,
            "original_mode": original_mode,
            "prepared_mode": image.mode,
            "mime_type": "image/jpeg",
            "size_bytes": len(payload_bytes),
            "file_name": os.path.basename(image_path),
        }

    def _prompt(self) -> str:
        return """
Tu es un assistant spécialisé dans l’analyse d’ordonnances médicales manuscrites ou imprimées.

Analyse cette image comme une ordonnance médicale potentielle.

Règles :
- Ne donne aucun conseil médical.
- Ne modifie pas la prescription.
- N’invente pas un médicament absent.
- Si l’écriture est difficile, indique l’incertitude.
- Ne réponds jamais brutalement “ce n’est pas une ordonnance” si l’image ressemble à une ordonnance.
- Extrais uniquement les éléments visibles.
- Priorité absolue : retourne d'abord les médicaments détectés.
- `raw_text_detected` doit être très court : maximum 280 caractères.
- N’inclus jamais les longues lignes de pointillés, cachets répétés, signatures ou remplissages décoratifs.
- Si tu identifies un médicament probable, ajoute-le dans `medicines` même si `needs_confirmation` est `true`.
- Retourne uniquement un JSON valide.

Format JSON attendu :
{
  "is_prescription": true,
  "global_confidence": 0.0,
  "medicines": [
    {
      "raw_text": "...",
      "medicine_name": "...",
      "dosage": "...",
      "form": "...",
      "quantity": "...",
      "posology": "...",
      "duration": "...",
      "confidence": 0.0,
      "needs_confirmation": true
    }
  ],
  "doctor_or_center": "...",
  "patient_name": "...",
  "raw_text_detected": "...",
  "uncertain_parts": [],
  "needs_manual_confirmation": true,
  "message_for_patient": "..."
}
""".strip()

    def _generate_content(self, payload: dict, image_path: str, image_meta: dict) -> tuple[dict, str]:
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
                logger.info(
                    "Calling Gemini generateContent",
                    extra={
                        "gemini_model": model_name,
                        "image_path": image_path,
                        "image_meta": image_meta,
                    },
                )
                with request.urlopen(req, timeout=self.request_timeout_seconds) as response:
                    return json.loads(response.read().decode("utf-8")), model_name
            except error.HTTPError as exc:
                last_http_error = exc
                if exc.code == 404 and model_name != candidate_models[-1]:
                    logger.warning("Gemini model %s not found, retrying with next fallback", model_name)
                    continue
                raise
            except TimeoutError as exc:
                last_generic_error = exc
                if model_name != candidate_models[-1]:
                    logger.warning("Gemini model %s timed out after %ss, retrying with next fallback", model_name, self.request_timeout_seconds)
                    continue
                raise
            except Exception as exc:
                last_generic_error = exc
                raise

        if last_http_error is not None:
            raise last_http_error
        if last_generic_error is not None:
            raise last_generic_error
        raise RuntimeError("Gemini call could not be initialized.")

    def _extract_text_content(self, payload: dict) -> str:
        candidates = payload.get("candidates") or []
        if not candidates:
            return ""
        parts = (((candidates[0] or {}).get("content") or {}).get("parts") or [])
        fragments = [str(part.get("text") or "") for part in parts if isinstance(part, dict)]
        return "\n".join(fragment for fragment in fragments if fragment).strip()

    def _parse_json_payload(self, content: str) -> dict:
        if not content:
            return {}
        cleaned = content.strip()
        if cleaned.startswith("```"):
            cleaned = cleaned.strip("`")
            cleaned = cleaned.replace("json", "", 1).strip()
        try:
            parsed = json.loads(cleaned)
            return parsed if isinstance(parsed, dict) else {}
        except json.JSONDecodeError:
            start = cleaned.find("{")
            end = cleaned.rfind("}")
            if start != -1 and end != -1 and end > start:
                fragment = cleaned[start:end + 1]
                try:
                    parsed = json.loads(fragment)
                    return parsed if isinstance(parsed, dict) else {}
                except json.JSONDecodeError:
                    pass
            logger.warning("Gemini returned non-JSON content: %s", cleaned[:1200])
            return {"raw_text_detected": cleaned, "needs_manual_confirmation": True, "message_for_patient": "La reponse Gemini doit etre verifiee manuellement."}

    def _normalize_medicines(self, items) -> list[dict]:
        normalized = []
        for item in items:
            if not isinstance(item, dict):
                continue
            medicine_name = str(item.get("medicine_name") or item.get("name") or "").strip()
            raw_text = str(item.get("raw_text") or medicine_name).strip()
            if not medicine_name and not raw_text:
                continue
            normalized.append(
                {
                    "raw_text": raw_text,
                    "name": medicine_name or raw_text,
                    "medicine_name": medicine_name or raw_text,
                    "dosage": str(item.get("dosage") or "").strip() or None,
                    "form": str(item.get("form") or "").strip() or None,
                    "quantity": str(item.get("quantity") or "").strip() or None,
                    "posology": str(item.get("posology") or "").strip() or None,
                    "duration": str(item.get("duration") or "").strip() or None,
                    "confidence": round(self._coerce_float(item.get("confidence"), 0.72), 2),
                    "needs_confirmation": bool(item.get("needs_confirmation", True)),
                }
            )
        return normalized

    def _failure(self, message: str, response_time_ms: int = 0, image_sent: bool = False, image_meta: dict | None = None) -> dict:
        logger.warning(
            "Gemini analysis failed",
            extra={
                "gemini_model": self.model,
                "response_time_ms": response_time_ms,
                "image_sent": image_sent,
                "image_meta": image_meta or {},
                "error_message": message,
            },
        )
        return {
            "success": False,
            "error": message,
            "medications": [],
            "text": "",
            "confidence": 0.0,
            "raw_response": {},
            "response_time_ms": response_time_ms,
            "image_sent": image_sent,
            "image_meta": image_meta or {},
        }

    def _coerce_float(self, value, default: float = 0.0) -> float:
        try:
            return float(value)
        except (TypeError, ValueError):
            return default

    def _normalize_model_name(self, value: str) -> str:
        normalized = (value or "").strip()
        if normalized.startswith("models/"):
            normalized = normalized.split("/", 1)[1]
        return normalized or "gemini-2.5-flash"
