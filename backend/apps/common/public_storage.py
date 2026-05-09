from __future__ import annotations

from django.core.files.storage import FileSystemStorage
from django.conf import settings


public_media_storage = FileSystemStorage(location=settings.MEDIA_ROOT, base_url=settings.MEDIA_URL)
