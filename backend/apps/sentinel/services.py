from __future__ import annotations

import json
import logging
import traceback as traceback_module
from typing import Any

from django.db import connection
from django.http import Http404
from django.utils import timezone

from .models import PharmiGoBugReport

logger = logging.getLogger(__name__)

SENSITIVE_KEYS = {
    "password",
    "new_password",
    "confirm_password",
    "token",
    "access",
    "refresh",
    "authorization",
    "credential",
    "proof_image",
    "profile_image",
    "pharmacy_image",
}


def _table_exists() -> bool:
    try:
        return PharmiGoBugReport._meta.db_table in connection.introspection.table_names()
    except Exception:
        return False


def _sanitize_value(value: Any) -> Any:
    if isinstance(value, dict):
        return {str(key): ("***" if str(key).lower() in SENSITIVE_KEYS else _sanitize_value(item)) for key, item in value.items()}
    if isinstance(value, (list, tuple)):
        return [_sanitize_value(item) for item in value]
    if hasattr(value, "name") and hasattr(value, "size"):
        return {"file_name": getattr(value, "name", "upload"), "size": getattr(value, "size", None)}
    if isinstance(value, (str, int, float, bool)) or value is None:
        return value
    return str(value)


def sanitize_request_payload(request) -> dict[str, Any]:
    payload: dict[str, Any] = {}
    try:
        if getattr(request, "GET", None):
            payload["query"] = _sanitize_value(request.GET.dict())
    except Exception:
        pass

    try:
        if getattr(request, "FILES", None):
            payload["files"] = {
                key: _sanitize_value(file_obj)
                for key, file_obj in request.FILES.items()
            }
    except Exception:
        pass

    try:
        content_type = (request.content_type or "").lower()
        if "application/json" in content_type and request.body:
            payload["body"] = _sanitize_value(json.loads(request.body.decode("utf-8")))
        elif getattr(request, "POST", None):
            payload["body"] = _sanitize_value(request.POST.dict())
    except Exception:
        try:
            raw_body = request.body.decode("utf-8", errors="replace")
            payload["body"] = {"raw": raw_body[:2000]}
        except Exception:
            pass

    return payload


def infer_actor_label(user) -> str:
    if user is None or not getattr(user, "is_authenticated", False):
        return "Visiteur"
    profile = getattr(user, "profile", None)
    pharmacy = getattr(profile, "pharmacy", None) if profile else None
    if pharmacy is not None:
        return f"Pharmacie {pharmacy.name} · user#{user.id}"
    if profile is not None:
        return f"{user.get_full_name().strip() or user.username or user.email} · {profile.role} · user#{user.id}"
    return f"{user.get_full_name().strip() or user.username or user.email} · user#{user.id}"


def infer_module_from_path(path: str) -> str:
    normalized = (path or "").lower()
    if "pharmigo/chatbot" in normalized or "chatbot" in normalized:
        return "Chatbot"
    if "payment" in normalized or "subscription" in normalized:
        return "Paiement"
    if "referral" in normalized or "ambassador" in normalized:
        return "Parrainage"
    if "stock" in normalized or "pharmacy" in normalized:
        return "Stock"
    if "prescription" in normalized or "ocr" in normalized:
        return "Ordonnances"
    if "auth" in normalized or "verify-email" in normalized:
        return "Authentification"
    return "Systeme"


def infer_severity(error_type: str, status_code: int | None = None) -> str:
    normalized = (error_type or "").lower()
    if status_code == 404:
        return "info"
    if "api" in normalized or "connection" in normalized or "timeout" in normalized:
        return "warning"
    if normalized in {"validationerror", "parseerror"}:
        return "info"
    if normalized == "http404":
        return "info"
    return "critical"


def create_bug_report(
    *,
    request=None,
    error_type: str,
    message: str = "",
    traceback_text: str = "",
    severity: str | None = None,
    module: str | None = None,
    status_code: int | None = None,
    request_data: dict[str, Any] | None = None,
    user=None,
) -> PharmiGoBugReport:
    if not _table_exists():
        raise RuntimeError("Sentinelle table unavailable")
    actor = user or getattr(request, "user", None)
    bug = PharmiGoBugReport.objects.create(
        error_type=error_type[:255],
        message=message[:4000],
        severity=severity or infer_severity(error_type, status_code=status_code),
        status="new",
        module=(module or infer_module_from_path(getattr(request, "path", "") or ""))[:80],
        user=actor if getattr(actor, "is_authenticated", False) else None,
        actor_label=infer_actor_label(actor),
        path=(getattr(request, "path", "") or "")[:255],
        method=(getattr(request, "method", "") or "")[:16],
        request_data=request_data if request_data is not None else (sanitize_request_payload(request) if request is not None else {}),
        traceback=traceback_text[:20000],
    )
    try:
        from pharmigo.api import broadcast_feed_event

        broadcast_feed_event(
            "bug.reported",
            {
                "id": bug.id,
                "severity": bug.severity,
                "status": bug.status,
                "module": bug.module,
                "error_type": bug.error_type,
                "created_at": timezone.localtime(bug.created_at).isoformat(),
            },
        )
    except Exception:
        logger.debug("Sentinelle broadcast skipped for bug %s", bug.id)
    return bug


def capture_exception(request, exc: Exception) -> None:
    try:
        create_bug_report(
            request=request,
            user=getattr(request, "user", None),
            error_type=exc.__class__.__name__,
            message=str(exc),
            traceback_text="".join(traceback_module.format_exception(type(exc), exc, exc.__traceback__)),
        )
    except Exception as logging_exc:  # pragma: no cover
        logger.exception("Sentinelle failed to capture exception: %s", logging_exc)


def capture_not_found(request) -> None:
    try:
        create_bug_report(
            request=request,
            user=getattr(request, "user", None),
            error_type=Http404.__name__,
            message="Resource not found",
            traceback_text="",
            status_code=404,
        )
    except Exception as logging_exc:  # pragma: no cover
        logger.exception("Sentinelle failed to capture 404: %s", logging_exc)


def capture_ai_failure(*, message: str, payload: dict[str, Any] | None = None) -> None:
    try:
        create_bug_report(
            error_type="APIConnectionError",
            message=message,
            traceback_text="",
            severity="warning",
            module="Chatbot",
            request_data=_sanitize_value(payload or {}),
        )
    except Exception as logging_exc:  # pragma: no cover
        logger.exception("Sentinelle failed to capture AI incident: %s", logging_exc)
