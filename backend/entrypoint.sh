#!/bin/sh
set -eu

PUBLIC_MEDIA_ROOT="${PHARMIGO_MEDIA_ROOT:-/app/media}"
mkdir -p "$PUBLIC_MEDIA_ROOT/prescriptions/files" "$PUBLIC_MEDIA_ROOT/prescriptions/images" "$PUBLIC_MEDIA_ROOT/pharmacies" /app/private_media/prescriptions
chmod -R 777 "$PUBLIC_MEDIA_ROOT" || true
chmod -R 700 /app/private_media || true

python - <<'PY'
import os
import time

import psycopg2

host = os.getenv("POSTGRES_HOST")
if not host:
    raise SystemExit(0)

name = os.getenv("POSTGRES_DB", "pharmigo")
user = os.getenv("POSTGRES_USER", "pharmigo")
password = os.getenv("POSTGRES_PASSWORD", "")
port = int(os.getenv("POSTGRES_PORT", "5432"))

for attempt in range(30):
    try:
        with psycopg2.connect(
            dbname=name,
            user=user,
            password=password,
            host=host,
            port=port,
        ) as connection:
            with connection.cursor() as cursor:
                cursor.execute("SELECT 1")
        print("PostgreSQL is ready.")
        break
    except Exception as exc:
        if attempt == 29:
            raise
        print(f"Waiting for PostgreSQL ({attempt + 1}/30): {exc}")
        time.sleep(2)
PY

python manage.py migrate
python - <<'PY'
import os

key = os.getenv("GEMINI_API_KEY", "").strip()

if key:
    print("Gemini vision integration enabled.")
else:
    print("Gemini vision integration disabled.")
PY
PORT_TO_BIND="${PORT:-8000}"
exec daphne -b 0.0.0.0 -p "$PORT_TO_BIND" pharmigo.asgi:application
