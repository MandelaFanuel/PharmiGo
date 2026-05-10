from datetime import timedelta
from hashlib import sha256
from unittest.mock import patch

from django.contrib.auth import get_user_model
from django.core import mail
from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import override_settings
from django.utils import timezone
from rest_framework.test import APITestCase

from apps.pharmacies.models import PharmacySubscription
from apps.users.models import EmailVerificationToken, UserProfile
from apps.users.serializers import DEFAULT_ADMIN_EMAIL, DEFAULT_ADMIN_PASSWORD
from apps.users.services import EmailDeliveryError, send_email_verification_for_user

User = get_user_model()


def extract_token_from_email(body: str) -> str:
    verification_link = next(line.strip() for line in body.splitlines() if "/verify-email?token=" in line)
    return verification_link.split("token=", 1)[1]


@override_settings(
    EMAIL_BACKEND="django.core.mail.backends.locmem.EmailBackend",
    FRONTEND_URL="http://localhost:5173",
    FRONTEND_APP_URL="http://localhost:5173",
)
class AuthenticationFlowTests(APITestCase):
    def test_patient_register_creates_unverified_user_and_hashed_token(self):
        response = self.client.post(
            "/api/auth/register/",
            {
                "account_type": "patient",
                "username": "patient-test",
                "phone_number": "+25761000002",
                "email": "patient-test@example.com",
                "password": "secret123",
            },
            format="json",
        )

        self.assertEqual(response.status_code, 201)
        self.assertNotIn("token", response.data)
        user = User.objects.get(username="patient-test")
        self.assertFalse(user.profile.email_verified)
        self.assertEqual(len(mail.outbox), 1)

        raw_token = extract_token_from_email(mail.outbox[0].body)
        token_record = EmailVerificationToken.objects.get(user=user)
        self.assertEqual(token_record.token_hash, sha256(raw_token.encode("utf-8")).hexdigest())
        self.assertNotEqual(token_record.token_hash, raw_token)

    def test_patient_register_persists_browser_coordinates_when_provided(self):
        response = self.client.post(
            "/api/auth/register/",
            {
                "account_type": "patient",
                "username": "patient-located",
                "phone_number": "+25761000022",
                "email": "patient-located@example.com",
                "password": "secret123",
                "latitude": -3.3822,
                "longitude": 29.3644,
            },
            format="json",
        )

        self.assertEqual(response.status_code, 201)
        profile = User.objects.get(username="patient-located").profile
        self.assertEqual(profile.latitude, -3.3822)
        self.assertEqual(profile.longitude, 29.3644)

    def test_email_verification_with_valid_token_marks_email_verified(self):
        self.client.post(
            "/api/auth/register/",
            {
                "account_type": "patient",
                "username": "verify-me",
                "phone_number": "+25761000004",
                "email": "verify-me@example.com",
                "password": "secret123",
            },
            format="json",
        )

        raw_token = extract_token_from_email(mail.outbox[0].body)
        verify_response = self.client.post("/api/auth/verify-email/", {"token": raw_token}, format="json")

        self.assertEqual(verify_response.status_code, 200)
        user = User.objects.get(username="verify-me")
        user.refresh_from_db()
        token_record = EmailVerificationToken.objects.get(user=user)
        self.assertTrue(user.profile.email_verified)
        self.assertIsNotNone(token_record.used_at)

        login_response = self.client.post(
            "/api/auth/login/",
            {"email": "verify-me@example.com", "password": "secret123"},
            format="json",
        )
        self.assertEqual(login_response.status_code, 200)
        self.assertTrue(login_response.data["token"])

    def test_login_is_blocked_until_email_is_verified(self):
        self.client.post(
            "/api/auth/register/",
            {
                "account_type": "patient",
                "username": "blocked-user",
                "phone_number": "+25761000005",
                "email": "blocked-user@example.com",
                "password": "secret123",
            },
            format="json",
        )

        response = self.client.post(
            "/api/auth/login/",
            {"email": "blocked-user@example.com", "password": "secret123"},
            format="json",
        )

        self.assertEqual(response.status_code, 400)
        self.assertIn("pas encore verifiee", response.data["email"][0])

    def test_expired_verification_token_fails(self):
        user = User.objects.create_user(username="expired-user", email="expired@example.com", password="secret123")
        UserProfile.objects.create(user=user, role="patient", phone_number="+25761000006", email_verified=False)
        send_email_verification_for_user(user)
        raw_token = extract_token_from_email(mail.outbox[0].body)
        token_record = EmailVerificationToken.objects.get(user=user)
        token_record.expires_at = timezone.now() - timedelta(minutes=1)
        token_record.save(update_fields=["expires_at"])

        response = self.client.post("/api/auth/verify-email/", {"token": raw_token}, format="json")

        self.assertEqual(response.status_code, 400)
        self.assertIn("expire", response.data["token"][0])

    def test_used_verification_token_fails(self):
        user = User.objects.create_user(username="used-user", email="used@example.com", password="secret123")
        UserProfile.objects.create(user=user, role="patient", phone_number="+25761000007", email_verified=False)
        send_email_verification_for_user(user)
        raw_token = extract_token_from_email(mail.outbox[0].body)

        first_response = self.client.post("/api/auth/verify-email/", {"token": raw_token}, format="json")
        second_response = self.client.post("/api/auth/verify-email/", {"token": raw_token}, format="json")

        self.assertEqual(first_response.status_code, 200)
        self.assertEqual(second_response.status_code, 400)
        self.assertIn("deja ete utilise", second_response.data["token"][0])

    def test_resend_verification_email_invalidates_previous_token(self):
        self.client.post(
            "/api/auth/register/",
            {
                "account_type": "patient",
                "username": "resend-user",
                "phone_number": "+25761000008",
                "email": "resend-user@example.com",
                "password": "secret123",
            },
            format="json",
        )

        user = User.objects.get(username="resend-user")
        first_token = EmailVerificationToken.objects.get(user=user)

        response = self.client.post(
            "/api/auth/resend-verification-email/",
            {"email": "resend-user@example.com"},
            format="json",
        )

        self.assertEqual(response.status_code, 200)
        first_token.refresh_from_db()
        latest_token = EmailVerificationToken.objects.filter(user=user).first()
        self.assertIsNotNone(first_token.used_at)
        self.assertIsNotNone(latest_token)
        self.assertNotEqual(first_token.id, latest_token.id)
        self.assertIsNone(latest_token.used_at)

    def test_resend_verification_email_is_generic_for_unknown_email(self):
        response = self.client.post(
            "/api/auth/resend-verification-email/",
            {"email": "missing@example.com"},
            format="json",
        )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data["message"], "Si ce compte existe, un email de verification a ete envoye.")

    def test_default_admin_can_login_with_email_credentials(self):
        if not DEFAULT_ADMIN_PASSWORD:
            self.skipTest("DEFAULT_ADMIN_PASSWORD is not configured for this test environment.")
        response = self.client.post(
            "/api/auth/login/",
            {
                "email": DEFAULT_ADMIN_EMAIL,
                "password": DEFAULT_ADMIN_PASSWORD,
            },
            format="json",
        )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data["user"]["email"], DEFAULT_ADMIN_EMAIL)
        self.assertTrue(response.data["user"]["is_staff"])
        self.assertTrue(response.data["token"])

    def test_login_with_phone_number_is_rejected(self):
        self.client.post(
            "/api/auth/register/",
            {
                "account_type": "patient",
                "username": "phone-login-user",
                "phone_number": "+25761000222",
                "email": "phone-login-user@example.com",
                "password": "secret123",
            },
            format="json",
        )

        response = self.client.post(
            "/api/auth/login/",
            {"email": "+25761000222", "password": "secret123"},
            format="json",
        )

        self.assertEqual(response.status_code, 400)
        self.assertIn("email", response.data)

    def test_patient_profile_patch_can_store_profile_image(self):
        user = User.objects.create_user(username="patient-photo", email="patient-photo@example.com", password="secret123")
        UserProfile.objects.create(user=user, role="patient", phone_number="+25761000999", email_verified=True)
        self.client.force_authenticate(user=user)

        uploaded = SimpleUploadedFile("avatar.png", b"fake-patient-image", content_type="image/png")
        response = self.client.patch(
            "/api/profile/",
            {
                "username": "patient-photo",
                "phone_number": "+25761000999",
                "email": "patient-photo@example.com",
                "profile_image": uploaded,
            },
            format="multipart",
        )

        self.assertEqual(response.status_code, 200)
        user.refresh_from_db()
        self.assertTrue(bool(user.profile.profile_image))
        self.assertIn("/api/users/", response.data["profile"]["profile_image"])

    def test_admin_profile_patch_can_store_profile_image(self):
        admin = User.objects.create_user(
            username="admin-photo",
            email="admin-photo@example.com",
            password="secret123",
            is_staff=True,
            is_superuser=True,
        )
        UserProfile.objects.create(user=admin, role="admin", phone_number="", email_verified=True)
        self.client.force_authenticate(user=admin)

        uploaded = SimpleUploadedFile("admin.png", b"fake-admin-image", content_type="image/png")
        response = self.client.patch(
            "/api/profile/",
            {
                "username": "admin-photo",
                "email": "admin-photo@example.com",
                "profile_image": uploaded,
            },
            format="multipart",
        )

        self.assertEqual(response.status_code, 200)
        admin.refresh_from_db()
        self.assertTrue(bool(admin.profile.profile_image))
        self.assertIn("/api/users/", response.data["profile"]["profile_image"])

    def test_pharmacy_register_requires_email_and_creates_trial_subscription(self):
        response = self.client.post(
            "/api/auth/register/",
            {
                "account_type": "pharmacy",
                "pharmacy_name": "Pharmacie Test",
                "phone_number": "+25761000003",
                "email": "pharmacy-test@example.com",
                "address": "Rohero, Bujumbura",
                "password": "secret123",
            },
            format="json",
        )

        self.assertEqual(response.status_code, 201)
        profile = UserProfile.objects.select_related("pharmacy").get(user__username=response.data["user"]["username"])
        subscription = PharmacySubscription.objects.get(pharmacy=profile.pharmacy)
        self.assertEqual(subscription.subscription_status, "trial")
        self.assertTrue(subscription.is_trial_active)
        self.assertFalse(profile.email_verified)

    def test_pharmacy_register_with_coordinates_updates_profile_and_pharmacy_position(self):
        response = self.client.post(
            "/api/auth/register/",
            {
                "account_type": "pharmacy",
                "pharmacy_name": "Pharmacie GPS",
                "phone_number": "+25761000031",
                "email": "pharmacy-gps@example.com",
                "address": "Gihosha, Bujumbura",
                "password": "secret123",
                "latitude": -3.3612,
                "longitude": 29.3598,
                "location_city": "Bujumbura",
                "location_country": "Burundi",
            },
            format="json",
        )

        self.assertEqual(response.status_code, 201)
        profile = UserProfile.objects.select_related("pharmacy").get(user__username=response.data["user"]["username"])
        self.assertEqual(profile.latitude, -3.3612)
        self.assertEqual(profile.longitude, 29.3598)
        self.assertEqual(profile.location_city, "Bujumbura")
        self.assertEqual(profile.location_country, "Burundi")
        self.assertEqual(profile.pharmacy.latitude, -3.3612)
        self.assertEqual(profile.pharmacy.longitude, 29.3598)
        self.assertEqual(profile.pharmacy.city, "Bujumbura")

    def test_patient_register_without_email_is_rejected(self):
        response = self.client.post(
            "/api/auth/register/",
            {
                "account_type": "patient",
                "username": "patient-no-email",
                "phone_number": "+25761000012",
                "password": "secret123",
            },
            format="json",
        )

        self.assertEqual(response.status_code, 400)
        self.assertIn("email", response.data)

    def test_patient_register_with_duplicate_phone_number_is_rejected(self):
        self.client.post(
            "/api/auth/register/",
            {
                "account_type": "patient",
                "username": "patient-first",
                "phone_number": "+25761000333",
                "email": "patient-first@example.com",
                "password": "secret123",
            },
            format="json",
        )

        response = self.client.post(
            "/api/auth/register/",
            {
                "account_type": "patient",
                "username": "patient-second",
                "phone_number": "+25761000333",
                "email": "patient-second@example.com",
                "password": "secret123",
            },
            format="json",
        )

        self.assertEqual(response.status_code, 400)
        self.assertIn("phone_number", response.data)

    def test_patient_register_with_duplicate_email_is_rejected(self):
        self.client.post(
            "/api/auth/register/",
            {
                "account_type": "patient",
                "username": "patient-mail-first",
                "phone_number": "+25761000444",
                "email": "duplicate@example.com",
                "password": "secret123",
            },
            format="json",
        )

        response = self.client.post(
            "/api/auth/register/",
            {
                "account_type": "patient",
                "username": "patient-mail-second",
                "phone_number": "+25761000555",
                "email": "duplicate@example.com",
                "password": "secret123",
            },
            format="json",
        )

        self.assertEqual(response.status_code, 400)
        self.assertIn("email", response.data)

    @patch("apps.users.views.send_email_verification_for_user", side_effect=EmailDeliveryError("Impossible d'envoyer l'email de verification pour le moment."))
    def test_register_succeeds_even_if_verification_email_delivery_fails(self, mocked_send):
        response = self.client.post(
            "/api/auth/register/",
            {
                "account_type": "patient",
                "username": "patient-email-retry",
                "phone_number": "+25761000999",
                "email": "patient-email-retry@example.com",
                "password": "secret123",
            },
            format="json",
        )

        self.assertEqual(response.status_code, 201)
        self.assertTrue(response.data["requires_email_verification"])
        self.assertIn("n'a pas pu etre envoye", response.data["message"])
        self.assertTrue(User.objects.filter(username="patient-email-retry").exists())
        mocked_send.assert_called_once()

    def test_pharmacy_register_with_duplicate_phone_number_is_rejected(self):
        self.client.post(
            "/api/auth/register/",
            {
                "account_type": "patient",
                "username": "patient-first-phone-lock",
                "phone_number": "+25761000666",
                "email": "patient-first-phone-lock@example.com",
                "password": "secret123",
            },
            format="json",
        )

        response = self.client.post(
            "/api/auth/register/",
            {
                "account_type": "pharmacy",
                "pharmacy_name": "Pharmacie Phone Duplicate",
                "phone_number": "+25761000666",
                "email": "pharmacy-phone-duplicate@example.com",
                "address": "Rohero, Bujumbura",
                "password": "secret123",
            },
            format="json",
        )

        self.assertEqual(response.status_code, 400)
        self.assertIn("phone_number", response.data)

    def test_password_reset_confirm_with_invalid_token_fails(self):
        user = User.objects.create_user(username="patient-reset-invalid", email="patient-reset-invalid@example.com", password="oldsecret123")
        UserProfile.objects.create(user=user, role="patient", phone_number="+25761000010", email_verified=True)

        request_response = self.client.post(
            "/api/auth/password-reset/",
            {"email": "patient-reset-invalid@example.com"},
            format="json",
        )

        self.assertEqual(request_response.status_code, 200)
        self.assertEqual(len(mail.outbox), 1)

        response = self.client.post(
            "/api/auth/password-reset/confirm/",
            {
                "uid": "baduid",
                "token": "badtoken",
                "new_password": "newsecret123",
            },
            format="json",
        )

        self.assertEqual(response.status_code, 400)
        self.assertIn("token", response.data)

    def test_password_reset_request_and_confirm_for_patient_email(self):
        user = User.objects.create_user(username="patient-reset", email="patient-reset@example.com", password="oldsecret123")
        UserProfile.objects.create(user=user, role="patient", phone_number="+25761000009", email_verified=True)

        request_response = self.client.post(
            "/api/auth/password-reset/",
            {"email": "patient-reset@example.com"},
            format="json",
        )

        self.assertEqual(request_response.status_code, 200)
        self.assertEqual(len(mail.outbox), 1)
        self.assertIn("/reset-password?uid=", mail.outbox[0].body)

        body = mail.outbox[0].body
        reset_link = next(line.strip() for line in body.splitlines() if "/reset-password?uid=" in line)
        query = reset_link.split("?", 1)[1]
        params = dict(part.split("=", 1) for part in query.split("&"))

        confirm_response = self.client.post(
            "/api/auth/password-reset/confirm/",
            {
                "uid": params["uid"],
                "token": params["token"],
                "new_password": "newsecret123",
            },
            format="json",
        )

        self.assertEqual(confirm_response.status_code, 200)
        login_response = self.client.post(
            "/api/auth/login/",
            {"email": "patient-reset@example.com", "password": "newsecret123"},
            format="json",
        )
        self.assertEqual(login_response.status_code, 200)

    def test_password_reset_request_is_generic_for_unknown_email(self):
        response = self.client.post(
            "/api/auth/password-reset/",
            {"email": "missing@example.com"},
            format="json",
        )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(len(mail.outbox), 0)
