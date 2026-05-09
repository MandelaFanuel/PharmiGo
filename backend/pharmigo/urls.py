from django.conf import settings
from django.conf.urls.static import static
from django.contrib import admin
from django.urls import include, path

from apps.prescriptions.views import ConfirmPrescriptionView, PrescriptionAnalysisTaskStatusView, PrescriptionUploadView
from apps.users.views import (
    GoogleLoginView,
    LoginView,
    LogoutView,
    PasswordResetConfirmView,
    PasswordResetRequestView,
    RegisterView,
    ResendVerificationEmailView,
    VerifyEmailView,
)
from pharmigo.api import (
    admin_dashboard,
    app_config,
    dashboard,
    endpoints,
    health_check,
    presence_heartbeat,
    presence_offline,
    profile,
    router,
)

urlpatterns = [
    path("admin/", admin.site.urls),
    path("api/auth/register/", RegisterView.as_view(), name="auth-register"),
    path("api/auth/login/", LoginView.as_view(), name="auth-login"),
    path("api/auth/google/", GoogleLoginView.as_view(), name="auth-google-login"),
    path("api/auth/logout/", LogoutView.as_view(), name="auth-logout"),
    path("api/auth/verify-email/", VerifyEmailView.as_view(), name="auth-verify-email"),
    path("api/auth/resend-verification-email/", ResendVerificationEmailView.as_view(), name="auth-resend-verification-email"),
    path("api/auth/password-reset/", PasswordResetRequestView.as_view(), name="auth-password-reset"),
    path("api/auth/password-reset/confirm/", PasswordResetConfirmView.as_view(), name="auth-password-reset-confirm"),
    path("api/register/", RegisterView.as_view(), name="register-fallback"),
    path("api/login/", LoginView.as_view(), name="login-fallback"),
    path("api/google/", GoogleLoginView.as_view(), name="google-fallback"),
    path("api/verify-email/", VerifyEmailView.as_view(), name="verify-email-fallback"),
    path("api/resend-verification-email/", ResendVerificationEmailView.as_view(), name="resend-verification-email-fallback"),
    path("api/password-reset/", PasswordResetRequestView.as_view(), name="password-reset-fallback"),
    path("api/password-reset/confirm/", PasswordResetConfirmView.as_view(), name="password-reset-confirm-fallback"),
    path("api/health/", health_check, name="health-check"),
    path("api/presence/heartbeat", presence_heartbeat, name="presence-heartbeat-no-slash"),
    path("api/presence/heartbeat/", presence_heartbeat, name="presence-heartbeat"),
    path("api/presence/offline", presence_offline, name="presence-offline-no-slash"),
    path("api/presence/offline/", presence_offline, name="presence-offline"),
    path("api/app-config/", app_config, name="app-config"),
    path("api/dashboard/", dashboard, name="dashboard"),
    path("api/admin/dashboard/", admin_dashboard, name="admin-dashboard"),
    path("api/profile/", profile, name="profile"),
    path("api/endpoints/", endpoints, name="endpoints"),
    path("api/upload-prescription/", PrescriptionUploadView.as_view(), name="upload-prescription-root"),
    path("api/confirm-prescription/", ConfirmPrescriptionView.as_view(), name="confirm-prescription-root"),
    path("api/prescription-analysis/<uuid:task_id>/", PrescriptionAnalysisTaskStatusView.as_view(), name="prescription-analysis-root"),
    path("api/prescriptions/", include("apps.prescriptions.urls")),
    path("api/pharmacies/", include("apps.pharmacies.urls")),
    path("api/", include(router.urls)),
    path("api/pharmigo/", include("apps.pharmigo_chatbot.urls")),
    path("api/chatbot/", include("apps.pharmigo_chatbot.chatbot_api_urls")),
]

if settings.DEBUG or getattr(settings, "PHARMIGO_SERVE_MEDIA", False):
    urlpatterns += static(settings.MEDIA_URL, document_root=settings.MEDIA_ROOT)
