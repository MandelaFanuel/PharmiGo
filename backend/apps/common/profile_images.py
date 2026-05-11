from __future__ import annotations

from typing import Any


def extract_uploaded_file_payload(uploaded_file: Any) -> tuple[bytes, str, str]:
    content = uploaded_file.read()
    if hasattr(uploaded_file, "seek"):
        uploaded_file.seek(0)

    content_type = getattr(uploaded_file, "content_type", "") or "application/octet-stream"
    original_name = getattr(uploaded_file, "name", "") or "image"
    return content, content_type, original_name


def apply_profile_image_backup(
    instance: Any,
    uploaded_file: Any,
    *,
    blob_field: str = "profile_image_blob",
    content_type_field: str = "profile_image_content_type",
    original_name_field: str = "profile_image_original_name",
) -> None:
    content, content_type, original_name = extract_uploaded_file_payload(uploaded_file)
    setattr(instance, blob_field, content)
    setattr(instance, content_type_field, content_type)
    setattr(instance, original_name_field, original_name)
