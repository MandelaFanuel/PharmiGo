from unittest.mock import patch

from django.contrib.auth.models import User
from django.test import TestCase

from apps.pharmigo_chatbot.services import ChatbotResponseService
from apps.users.models import UserProfile


class ChatbotResponseServiceTests(TestCase):
    def setUp(self):
        self.user = User.objects.create_user(
            username="patient-chatbot",
            email="patient-chatbot@example.com",
            password="testpass123",
        )
        UserProfile.objects.create(user=self.user, role="patient", email_verified=True)

    @patch("apps.pharmigo_chatbot.services.GeminiChatService.generate_response")
    def test_uses_gemini_humanized_reply_for_general_question(self, mocked_generate):
        mocked_generate.return_value = "Bonjour, je suis PharmiGo et je peux vous accompagner."

        response = ChatbotResponseService().answer("Bonjour PharmiGo", self.user)

        self.assertEqual(response, "Bonjour, je suis PharmiGo et je peux vous accompagner.")
        mocked_generate.assert_called_once()

    def test_falls_back_to_internal_answer_when_gemini_unavailable(self):
        service = ChatbotResponseService()
        service.gemini_chat.available = False

        response = service.answer("Comment utiliser PharmiGo ?", self.user)

        self.assertTrue(response)
        self.assertIsInstance(response, str)
        self.assertGreater(len(response), 20)
