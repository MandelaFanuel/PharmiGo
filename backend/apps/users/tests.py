from django.contrib.auth import get_user_model
from django.core import mail
from django.test import override_settings
from rest_framework.test import APITestCase

from apps.pharmacies.models import PharmacySubscription
from apps.users.models import UserProfile
from apps.users.serializers import DEFAULT_ADMIN_EMAIL, DEFAULT_ADMIN_PASSWORD

User = get_user_model()


@override_settings(
    EMAIL_BACKEND="django.core.mail.backends.locmem.EmailBackend",
    FRONTEND_APP_URL="http://localhost:5173",
)
class AuthenticationFlowTests(APITestCase):
    def test_patient_register_and_login(self):
        register_response = self.client.post(
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

        self.assertEqual(register_response.status_code, 201)
        self.assertTrue(User.objects.filter(username="patient-test").exists())
        self.assertTrue(UserProfile.objects.filter(user__username="patient-test", role="patient").exists())
        self.assertTrue(register_response.data["token"])

        login_response = self.client.post(
            "/api/auth/login/",
            {
                "phone_number": "+25761000002",
                "password": "secret123",
            },
            format="json",
        )

        self.assertEqual(login_response.status_code, 200)
        self.assertEqual(login_response.data["user"]["username"], "patient-test")
        self.assertTrue(login_response.data["token"])

    def test_patient_register_and_login_without_email(self):
        register_response = self.client.post(
            "/api/auth/register/",
            {
                "account_type": "patient",
                "username": "patient-no-email",
                "phone_number": "+25761000012",
                "password": "secret123",
            },
            format="json",
        )

        self.assertEqual(register_response.status_code, 201)
        self.assertEqual(register_response.data["user"]["email"], "")
        self.assertTrue(register_response.data["token"])

        login_response = self.client.post(
            "/api/auth/login/",
            {
                "phone_number": "+25761000012",
                "password": "secret123",
            },
            format="json",
        )

        self.assertEqual(login_response.status_code, 200)
        self.assertTrue(login_response.data["token"])

    def test_default_admin_can_login_with_email_credentials(self):
        if not DEFAULT_ADMIN_PASSWORD:
            self.skipTest("DEFAULT_ADMIN_PASSWORD is not configured for this test environment.")
        response = self.client.post(
            "/api/auth/login/",
            {
                "phone_number": DEFAULT_ADMIN_EMAIL,
                "password": DEFAULT_ADMIN_PASSWORD,
            },
            format="json",
        )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data["user"]["email"], DEFAULT_ADMIN_EMAIL)
        self.assertTrue(response.data["user"]["is_staff"])
        self.assertTrue(response.data["token"])

    def test_non_admin_email_is_rejected_for_login(self):
        response = self.client.post(
            "/api/auth/login/",
            {
                "phone_number": "wrong-admin@example.com",
                "password": "secret123",
            },
            format="json",
        )

        self.assertEqual(response.status_code, 400)
        self.assertIn("Seul l'administrateur peut se connecter par email", response.data["phone_number"][0])

    def test_pharmacy_register_creates_trial_subscription(self):
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

    def test_rejects_unsupported_phone_number_on_register(self):
        response = self.client.post(
            "/api/auth/register/",
            {
                "account_type": "patient",
                "username": "patient-bad-phone",
                "phone_number": "+250788123456",
                "email": "patient-bad-phone@example.com",
                "password": "secret123",
            },
            format="json",
        )

        self.assertEqual(response.status_code, 400)
        self.assertIn("Ce numero n'est pas admis", str(response.data))

    def test_accepts_tanzania_phone_number(self):
        register_response = self.client.post(
            "/api/auth/register/",
            {
                "account_type": "patient",
                "username": "patient-tz",
                "phone_number": "+255712345678",
                "email": "patient-tz@example.com",
                "password": "secret123",
            },
            format="json",
        )

        self.assertEqual(register_response.status_code, 201)

        login_response = self.client.post(
            "/api/auth/login/",
            {
                "phone_number": "+255712345678",
                "password": "secret123",
            },
            format="json",
        )

        self.assertEqual(login_response.status_code, 200)

    def test_password_reset_request_and_confirm_for_patient_email(self):
        user = User.objects.create_user(username="patient-reset", email="patient-reset@example.com", password="oldsecret123")
        UserProfile.objects.create(user=user, role="patient", phone_number="+25761000009")

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
            {"phone_number": "+25761000009", "password": "newsecret123"},
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

    def test_pharmacy_register_without_email_still_creates_trial_subscription(self):
        response = self.client.post(
            "/api/auth/register/",
            {
                "account_type": "pharmacy",
                "pharmacy_name": "Pharmacie Sans Email",
                "phone_number": "+25761000013",
                "address": "Rohero, Bujumbura",
                "password": "secret123",
            },
            format="json",
        )

        self.assertEqual(response.status_code, 201)
        profile = UserProfile.objects.select_related("pharmacy").get(user__username=response.data["user"]["username"])
        self.assertEqual(profile.pharmacy.email, "")
