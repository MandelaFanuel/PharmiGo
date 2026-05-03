from django.test import TestCase
from .models import Notification

class NotificationModelTest(TestCase):
    def setUp(self):
        self.notification = Notification.objects.create(
            title="Test Notification",
            message="This is a test notification.",
            is_read=False
        )

    def test_notification_creation(self):
        self.assertEqual(self.notification.title, "Test Notification")
        self.assertEqual(self.notification.message, "This is a test notification.")
        self.assertFalse(self.notification.is_read)

    def test_notification_str(self):
        self.assertEqual(str(self.notification), "Test Notification")

    def test_notification_read_status(self):
        self.notification.is_read = True
        self.notification.save()
        self.assertTrue(self.notification.is_read)

    def test_notification_update(self):
        self.notification.message = "Updated message."
        self.notification.save()
        self.assertEqual(self.notification.message, "Updated message.")