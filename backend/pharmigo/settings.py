import os
import secrets
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent.parent

def _read_bool_env(*names: str, default: bool = False) -> bool:
    for name in names:
        value = os.getenv(name)
        if value is None:
            continue
        return value.lower() in {"1", "true", "yes", "on"}
    return default

DEBUG = _read_bool_env("PHARMIGO_DEBUG", "DEBUG", default=True)
SECRET_KEY = os.getenv("SECRET_KEY", "").strip()
if not SECRET_KEY:
    if DEBUG:
        SECRET_KEY = secrets.token_urlsafe(64)
    else:
        raise RuntimeError("SECRET_KEY environment variable is required when PHARMIGO_DEBUG is disabled.")

ALLOWED_HOSTS = [
    host
    for host in os.getenv("ALLOWED_HOSTS", "localhost,127.0.0.1,0.0.0.0,testserver").split(",")
    if host
]

INSTALLED_APPS = [
    "django.contrib.admin",
    "django.contrib.auth",
    "django.contrib.contenttypes",
    "django.contrib.sessions",
    "django.contrib.messages",
    "django.contrib.staticfiles",
    "rest_framework",
    "rest_framework.authtoken",
    "corsheaders",
    "channels",
    "apps.users",
    "apps.pharmacies",
    "apps.prescriptions",
    "apps.chat",
    "apps.notifications",
    "apps.pharmigo_chatbot",
]

MIDDLEWARE = [
    "corsheaders.middleware.CorsMiddleware",
    "django.middleware.security.SecurityMiddleware",
    "django.contrib.sessions.middleware.SessionMiddleware",
    "django.middleware.common.CommonMiddleware",
    "django.middleware.csrf.CsrfViewMiddleware",
    "django.contrib.auth.middleware.AuthenticationMiddleware",
    "django.contrib.messages.middleware.MessageMiddleware",
    "django.middleware.clickjacking.XFrameOptionsMiddleware",
]

ROOT_URLCONF = "pharmigo.urls"
WSGI_APPLICATION = "pharmigo.wsgi.application"
ASGI_APPLICATION = "pharmigo.asgi.application"

TEMPLATES = [
    {
        "BACKEND": "django.template.backends.django.DjangoTemplates",
        "DIRS": [],
        "APP_DIRS": True,
        "OPTIONS": {
            "context_processors": [
                "django.template.context_processors.debug",
                "django.template.context_processors.request",
                "django.contrib.auth.context_processors.auth",
                "django.contrib.messages.context_processors.messages",
            ]
        },
    }
]

if os.getenv("POSTGRES_HOST"):
    DATABASES = {
        "default": {
            "ENGINE": "django.db.backends.postgresql",
            "NAME": os.getenv("POSTGRES_DB", "pharmigo"),
            "USER": os.getenv("POSTGRES_USER", "pharmigo"),
            "PASSWORD": os.getenv("POSTGRES_PASSWORD", ""),
            "HOST": os.getenv("POSTGRES_HOST", "db"),
            "PORT": os.getenv("POSTGRES_PORT", "5432"),
        }
    }
else:
    DATABASES = {
        "default": {
            "ENGINE": "django.db.backends.sqlite3",
            "NAME": BASE_DIR / "db.sqlite3",
        }
    }

AUTH_PASSWORD_VALIDATORS = []

LANGUAGE_CODE = "fr-fr"
TIME_ZONE = "Africa/Bujumbura"
USE_I18N = True
USE_TZ = True

STATIC_URL = "/static/"
STATIC_ROOT = BASE_DIR / "staticfiles"
MEDIA_URL = "/media/"
MEDIA_ROOT = BASE_DIR / "media"
PRIVATE_MEDIA_ROOT = BASE_DIR / "private_media"

DEFAULT_AUTO_FIELD = "django.db.models.BigAutoField"

CORS_ALLOWED_ORIGINS = [
    origin
    for origin in os.getenv(
        "CORS_ALLOWED_ORIGINS",
        "http://localhost:3000,http://127.0.0.1:3000,http://localhost:3001,http://127.0.0.1:3001",
    ).split(",")
    if origin
]
CORS_ALLOW_ALL_ORIGINS = DEBUG
CORS_ALLOW_CREDENTIALS = True
CORS_ALLOW_HEADERS = [
    "accept",
    "accept-encoding",
    "authorization",
    "content-type",
    "dnt",
    "origin",
    "user-agent",
    "x-csrftoken",
    "x-requested-with",
]

REST_FRAMEWORK = {
    "DEFAULT_PERMISSION_CLASSES": ["rest_framework.permissions.AllowAny"],
    "DEFAULT_AUTHENTICATION_CLASSES": [
        "pharmigo.authentication.PharmigoTokenAuthentication",
        "rest_framework.authentication.SessionAuthentication",
    ],
}

if os.getenv("REDIS_HOST"):
    CHANNEL_LAYERS = {
        "default": {
            "BACKEND": "channels_redis.core.RedisChannelLayer",
            "CONFIG": {
                "hosts": [(os.environ.get("REDIS_HOST", "localhost"), 6379)],
            },
        }
    }
else:
    CHANNEL_LAYERS = {
        "default": {
            "BACKEND": "channels.layers.InMemoryChannelLayer",
        }
    }

GEMINI_API_KEY = os.getenv("GEMINI_API_KEY", "").strip()
GEMINI_ENABLED = _read_bool_env("GEMINI_ENABLED", default=True)
GEMINI_MODEL = os.getenv("GEMINI_MODEL", "gemini-2.5-flash").strip() or "gemini-2.5-flash"
GOOGLE_VISION_ENABLED = _read_bool_env("GOOGLE_VISION_ENABLED", default=False)
GOOGLE_APPLICATION_CREDENTIALS = os.getenv("GOOGLE_APPLICATION_CREDENTIALS", "").strip()

FRONTEND_URL = (
    os.getenv("FRONTEND_URL", "").strip()
    or os.getenv("FRONTEND_APP_URL", "").strip()
    or "http://localhost:3001"
)
FRONTEND_APP_URL = FRONTEND_URL
EMAIL_FROM = (
    os.getenv("EMAIL_FROM", "").strip()
    or os.getenv("DEFAULT_FROM_EMAIL", "").strip()
    or "no-reply@pharmigo.local"
)
DEFAULT_FROM_EMAIL = EMAIL_FROM
RESEND_API_KEY = os.getenv("RESEND_API_KEY", "").strip()
RESEND_API_URL = os.getenv("RESEND_API_URL", "https://api.resend.com/emails").strip() or "https://api.resend.com/emails"
RESEND_FROM_EMAIL = os.getenv("RESEND_FROM_EMAIL", "").strip() or EMAIL_FROM

SMTP_HOST = os.getenv("SMTP_HOST", "").strip() or os.getenv("EMAIL_HOST", "").strip()
SMTP_PORT = os.getenv("SMTP_PORT", os.getenv("EMAIL_PORT", "")).strip()
SMTP_USER = os.getenv("SMTP_USER", "").strip() or os.getenv("EMAIL_HOST_USER", "").strip()
SMTP_PASSWORD = (
    os.getenv("SMTP_PASSWORD", "").strip()
    or os.getenv("SMTP_PASS", "").strip()
    or os.getenv("EMAIL_HOST_PASSWORD", "").strip()
)

if not SMTP_HOST and SMTP_USER.endswith("@gmail.com"):
    SMTP_HOST = "smtp.gmail.com"
if not SMTP_PORT and SMTP_HOST == "smtp.gmail.com":
    SMTP_PORT = "587"

SMTP_CONFIGURED = bool(SMTP_HOST and SMTP_PORT and (SMTP_USER or SMTP_PASSWORD))
DEFAULT_EMAIL_BACKEND = "django.core.mail.backends.smtp.EmailBackend" if SMTP_CONFIGURED else "django.core.mail.backends.console.EmailBackend"
EMAIL_BACKEND = os.getenv("EMAIL_BACKEND", DEFAULT_EMAIL_BACKEND).strip() or DEFAULT_EMAIL_BACKEND
EMAIL_HOST = SMTP_HOST or "localhost"
EMAIL_PORT = int(SMTP_PORT or "25")
EMAIL_HOST_USER = SMTP_USER
EMAIL_HOST_PASSWORD = SMTP_PASSWORD
EMAIL_USE_TLS = _read_bool_env("EMAIL_USE_TLS", default=EMAIL_HOST == "smtp.gmail.com" and EMAIL_PORT == 587)
EMAIL_USE_SSL = _read_bool_env("EMAIL_USE_SSL", "SMTP_SECURE", default=False)
GOOGLE_OAUTH_CLIENT_ID = os.getenv("GOOGLE_OAUTH_CLIENT_ID", "").strip()
