from datetime import timedelta

from django.contrib.auth import get_user_model
from django.utils import timezone
from rest_framework.test import APITestCase

from apps.chat.models import ChatMessage
from apps.notifications.models import Notification
from apps.pharmacies.models import Pharmacy, PharmacySubscription
from apps.users.models import UserProfile

User = get_user_model()


class ChatMessageApiTests(APITestCase):
    def setUp(self):
        self.patient_user = User.objects.create_user(username="patient-chat", password="secret123")
        UserProfile.objects.create(
            user=self.patient_user,
            role="patient",
            phone_number="+25761000111",
            whatsapp_number="+25761000111",
            address="Kamenge",
        )

        self.pharmacy_user = User.objects.create_user(username="pharmacy-chat", password="secret123")
        self.pharmacy = Pharmacy.objects.create(
            name="Pharmacie Chat",
            city="Bujumbura",
            address="Rohero",
            phone_number="+25761000112",
            email="chat@pharmigo.com",
        )
        UserProfile.objects.create(
            user=self.pharmacy_user,
            role="pharmacy",
            phone_number="+25761000112",
            whatsapp_number="+25761000112",
            address="Rohero",
            pharmacy=self.pharmacy,
        )
        PharmacySubscription.objects.create(
            pharmacy=self.pharmacy,
            subscription_status="active",
            is_trial_active=False,
            trial_end_date=timezone.now() + timedelta(days=30),
            next_payment_due_date=timezone.now() + timedelta(days=30),
        )

    def test_patient_can_send_message_to_pharmacy_and_fetch_thread(self):
        self.client.force_authenticate(user=self.patient_user)

        response = self.client.post(
            "/api/messages/",
            {
                "pharmacy": self.pharmacy.id,
                "message": "Bonjour, avez-vous ce medicament ?",
            },
            format="json",
        )

        self.assertEqual(response.status_code, 201)
        self.assertEqual(response.data["sender_role"], "patient")
        self.assertEqual(response.data["sender_user"], self.patient_user.id)
        self.assertEqual(response.data["pharmacy"], self.pharmacy.id)

        list_response = self.client.get("/api/messages/")
        self.assertEqual(list_response.status_code, 200)
        self.assertEqual(len(list_response.data), 1)
        self.assertEqual(list_response.data[0]["message"], "Bonjour, avez-vous ce medicament ?")

        self.assertTrue(
            Notification.objects.filter(
                channel="messages:pharmacy",
                recipient_pharmacy=self.pharmacy,
            ).exists()
        )

    def test_pharmacy_can_reply_to_patient_after_existing_interaction(self):
        ChatMessage.objects.create(
            pharmacy=self.pharmacy,
            sender_user=self.patient_user,
            sender_name=self.patient_user.username,
            sender_role="patient",
            message="Bonjour",
        )

        self.client.force_authenticate(user=self.pharmacy_user)
        response = self.client.post(
            "/api/messages/",
            {
                "recipient_user": self.patient_user.id,
                "message": "Oui, nous pouvons vous aider.",
            },
            format="json",
        )

        self.assertEqual(response.status_code, 201)
        self.assertEqual(response.data["sender_role"], "pharmacy")
        self.assertEqual(response.data["sender_pharmacy"], self.pharmacy.id)
        self.assertEqual(response.data["recipient_user"], self.patient_user.id)

        list_response = self.client.get("/api/messages/")
        self.assertEqual(list_response.status_code, 200)
        self.assertEqual(len(list_response.data), 2)

        self.assertTrue(
            Notification.objects.filter(
                channel="messages:patient",
                recipient_user=self.patient_user,
            ).exists()
        )

    def test_pharmacy_cannot_message_unrelated_patient_first(self):
        self.client.force_authenticate(user=self.pharmacy_user)
        response = self.client.post(
            "/api/messages/",
            {
                "recipient_user": self.patient_user.id,
                "message": "Bonjour",
            },
            format="json",
        )

        self.assertEqual(response.status_code, 400)
        self.assertIn("recipient_user", response.data)
