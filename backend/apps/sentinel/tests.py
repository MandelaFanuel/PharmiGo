from django.contrib.auth import get_user_model
from django.test import override_settings
from rest_framework.test import APITestCase

from apps.sentinel.models import PharmiGoBugReport

User = get_user_model()


@override_settings(FRONTEND_URL="http://localhost:3001", FRONTEND_APP_URL="http://localhost:3001")
class SentinelMiddlewareTests(APITestCase):
    def test_root_health_endpoint_returns_success(self):
        response = self.client.get("/")

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data["status"], "ok")

    def test_api_health_supports_head_requests(self):
        response = self.client.head("/api/health/")

        self.assertEqual(response.status_code, 200)

    def test_critical_api_404_is_captured_in_bug_table(self):
        response = self.client.get("/api/route-introuvable/")

        self.assertEqual(response.status_code, 404)
        self.assertTrue(PharmiGoBugReport.objects.filter(error_type="Http404", path="/api/route-introuvable/").exists())


class SentinelAdminApiTests(APITestCase):
    def setUp(self):
        self.admin = User.objects.create_user(username="sentinel-admin", password="secret123", is_staff=True)
        self.client.force_authenticate(self.admin)
        self.bug = PharmiGoBugReport.objects.create(
            error_type="ValueError",
            message="Test bug",
            severity="critical",
            status="new",
            module="Systeme",
            actor_label="Admin de test",
            path="/api/test/",
            method="POST",
            request_data={"sample": "value"},
            traceback="traceback-line",
        )

    def test_admin_can_update_bug_status(self):
        response = self.client.patch("/api/admin/bugs/", {"id": self.bug.id, "status": "resolved"}, format="json")

        self.assertEqual(response.status_code, 200)
        self.bug.refresh_from_db()
        self.assertEqual(self.bug.status, "resolved")

    def test_admin_can_clear_bug_reports(self):
        response = self.client.delete("/api/admin/bugs/")

        self.assertEqual(response.status_code, 200)
        self.assertEqual(PharmiGoBugReport.objects.count(), 0)
