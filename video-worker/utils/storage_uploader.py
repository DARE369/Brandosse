# video-worker/utils/storage_uploader.py
# Uploads rendered clips and thumbnails to Supabase Storage.

import os

from database import supabase
from logger import log


CLIPS_BUCKET = "video-clips"
SIGNED_URL_EXPIRY_SECONDS = 172800


def upload_clip_to_storage(
    local_path: str,
    storage_path: str,
    content_type: str = "video/mp4",
) -> tuple[bool, str]:
    """
    Upload a local file to Supabase Storage.
    """
    if not os.path.exists(local_path):
        return False, f"Local file not found: {local_path}"

    file_size_mb = os.path.getsize(local_path) / (1024 * 1024)
    log.info(
        "storage_upload_start",
        storage_path=storage_path,
        size_mb=round(file_size_mb, 2),
    )

    try:
        with open(local_path, "rb") as file_handle:
            supabase.storage.from_(CLIPS_BUCKET).upload(
                path=storage_path,
                file=file_handle,
                file_options={"content-type": content_type, "upsert": "true"},
            )

        log.info(
            "storage_upload_complete",
            storage_path=storage_path,
            size_mb=round(file_size_mb, 2),
        )
        return True, storage_path

    except Exception as e:
        error_msg = f"Upload failed for {storage_path}: {str(e)}"
        log.error("storage_upload_failed", storage_path=storage_path, error=str(e))
        return False, error_msg


def get_signed_url(storage_path: str) -> tuple[bool, str]:
    """
    Generate a 48-hour signed URL for a clip bucket path.
    """
    try:
        response = supabase.storage.from_(CLIPS_BUCKET).create_signed_url(
            path=storage_path,
            expires_in=SIGNED_URL_EXPIRY_SECONDS,
        )

        signed_url = response.get("signedURL") or response.get("signedUrl")
        if not signed_url:
            return False, f"No signed URL in response: {response}"

        return True, signed_url

    except Exception as e:
        log.error("signed_url_failed", storage_path=storage_path, error=str(e))
        return False, f"Failed to generate signed URL: {str(e)}"


def upload_and_sign(
    local_path: str,
    storage_path: str,
    content_type: str = "video/mp4",
) -> tuple[bool, str, str]:
    """
    Upload a file and generate a signed URL.

    Returns (True, storage_path, signed_url) or (False, "", error_message).
    """
    upload_ok, upload_result = upload_clip_to_storage(local_path, storage_path, content_type)
    if not upload_ok:
        return False, "", upload_result

    sign_ok, sign_result = get_signed_url(storage_path)
    if not sign_ok:
        log.warning(
            "upload_succeeded_but_signing_failed",
            storage_path=storage_path,
            error=sign_result,
        )
        return True, storage_path, ""

    return True, storage_path, sign_result
