from __future__ import annotations

from pathlib import Path

from django.conf import settings
from django.core.files.storage import FileSystemStorage


class PharmigoPublicMediaStorage(FileSystemStorage):
    """Public media storage with legacy-read fallback for production migrations.

    Files are always written to the current MEDIA_ROOT. For reads we also look in
    the legacy `<BASE_DIR>/media` tree so older uploads remain available after a
    disk-path migration.
    """

    def __init__(self) -> None:
        super().__init__(location=settings.MEDIA_ROOT, base_url=settings.MEDIA_URL)
        self.legacy_location = Path(settings.BASE_DIR) / "media"

    def _legacy_path(self, name: str) -> str:
        return str(self.legacy_location / name)

    def exists(self, name: str) -> bool:
        if super().exists(name):
            return True
        legacy_path = self._legacy_path(name)
        return Path(legacy_path).exists()

    def open(self, name: str, mode: str = "rb"):
        if super().exists(name):
            return super().open(name, mode)
        legacy_path = self._legacy_path(name)
        if Path(legacy_path).exists():
            return open(legacy_path, mode)  # noqa: P201
        return super().open(name, mode)

    def path(self, name: str) -> str:
        primary_path = super().path(name)
        if Path(primary_path).exists():
            return primary_path
        legacy_path = self._legacy_path(name)
        if Path(legacy_path).exists():
            return legacy_path
        return primary_path


public_media_storage = PharmigoPublicMediaStorage()
