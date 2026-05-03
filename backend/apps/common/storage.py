from __future__ import annotations

from pathlib import Path
from uuid import uuid4

from django.conf import settings
from django.core.files.storage import FileSystemStorage


class PrivatePrescriptionStorage(FileSystemStorage):
    def __init__(self) -> None:
        super().__init__(location=settings.PRIVATE_MEDIA_ROOT)

    def url(self, name: str) -> str:
        raise ValueError("Private prescription files do not have public URLs.")


private_prescription_storage = PrivatePrescriptionStorage()


def build_private_prescription_name(filename: str) -> str:
    suffix = Path(filename or "").suffix.lower() or ".bin"
    return f"prescriptions/{uuid4().hex}{suffix}"
