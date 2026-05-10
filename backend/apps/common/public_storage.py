from __future__ import annotations

import re
from pathlib import Path

from django.conf import settings
from django.core.files.storage import FileSystemStorage


_DJANGO_SUFFIX_RE = re.compile(r"^(?P<base>.+)_(?P<suffix>[A-Za-z0-9]{7})$")


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

    def _normalize_stem(self, stem: str) -> str:
        match = _DJANGO_SUFFIX_RE.match(stem)
        if match:
            return match.group("base")
        return stem

    def _resolve_existing_path(self, name: str) -> Path | None:
        primary_path = Path(super().path(name))
        if primary_path.exists():
            return primary_path

        legacy_path = Path(self._legacy_path(name))
        if legacy_path.exists():
            return legacy_path

        relative_path = Path(name)
        normalized_stem = self._normalize_stem(relative_path.stem)
        if not normalized_stem:
            return None

        candidate_dirs = [
            primary_path.parent,
            legacy_path.parent,
        ]
        for directory in candidate_dirs:
            if not directory.exists() or not directory.is_dir():
                continue

            matches: list[Path] = []
            for candidate in directory.iterdir():
                if not candidate.is_file() or candidate.suffix.lower() != relative_path.suffix.lower():
                    continue
                if self._normalize_stem(candidate.stem) == normalized_stem:
                    matches.append(candidate)

            if len(matches) == 1:
                return matches[0]

        return None

    def exists(self, name: str) -> bool:
        return self._resolve_existing_path(name) is not None

    def open(self, name: str, mode: str = "rb"):
        resolved_path = self._resolve_existing_path(name)
        if resolved_path is None:
            return super().open(name, mode)
        return open(resolved_path, mode)  # noqa: P201

    def path(self, name: str) -> str:
        resolved_path = self._resolve_existing_path(name)
        if resolved_path is not None:
            return str(resolved_path)
        return super().path(name)


public_media_storage = PharmigoPublicMediaStorage()
