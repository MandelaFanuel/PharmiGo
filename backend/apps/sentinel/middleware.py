from __future__ import annotations

from django.http import Http404

from .services import capture_exception, capture_not_found


class BugTrackerMiddleware:
    """Capture runtime incidents without replacing Django's native logging."""

    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        try:
            response = self.get_response(request)
        except Exception as exc:
            capture_exception(request, exc)
            raise

        if response.status_code == 404 and self._should_capture_404(request):
            capture_not_found(request)
        return response

    @staticmethod
    def _should_capture_404(request) -> bool:
        path = (getattr(request, "path", "") or "").lower()
        if path.startswith("/static/") or path.startswith("/media/"):
            return False
        return path.startswith("/api/") or path.startswith("/ws/")

