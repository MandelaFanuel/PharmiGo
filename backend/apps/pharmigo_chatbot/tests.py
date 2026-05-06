from unittest.mock import patch

from django.contrib.auth.models import User
from django.test import TestCase

from apps.pharmigo_chatbot.models import ConversationHistory, ConversationSession
from apps.pharmigo_chatbot.services import ChatbotContextService, ChatbotResponseService
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
        self.assertNotIn("verification d'email", response.lower())
        self.assertNotIn("vérification d'email", response.lower())

    @patch("apps.pharmigo_chatbot.services.GeminiChatService.generate_response")
    def test_greeting_does_not_trigger_medication_lookup(self, mocked_generate):
        mocked_generate.return_value = "Bonjour, je suis PharmiGo et je peux vous accompagner."
        service = ChatbotResponseService()

        with patch.object(service, "_answer_medicine_lookup", wraps=service._answer_medicine_lookup) as mocked_lookup:
            response = service.answer("Bonjour PharmiGo, peux-tu me dire ce que tu fais ?", self.user)

        self.assertEqual(response, "Bonjour, je suis PharmiGo et je peux vous accompagner.")
        mocked_lookup.assert_not_called()

    def test_context_builds_structured_memory_across_visits(self):
        session = ConversationSession.objects.create(user=self.user, session_key="user-1-default")
        ConversationHistory.objects.create(session=session, user=self.user, sender="user", message="Je cherche du paracetamol")
        ConversationHistory.objects.create(session=session, user=self.user, sender="bot", message="Je peux verifier les pharmacies.")
        ConversationHistory.objects.create(session=session, user=self.user, sender="user", message="J'ai aussi de la fievre depuis hier")

        context = ChatbotContextService().build_context(self.user)
        memory = context["conversation_memory"]

        self.assertGreaterEqual(memory["visit_count"], 1)
        self.assertTrue(memory["recurring_topics"])
        self.assertIn(memory["preferred_tone"], {"reassuring", "guided", "direct", "standard"})

    def test_health_question_returns_prudent_guidance_without_gemini(self):
        service = ChatbotResponseService()
        service.gemini_chat.available = False

        response = service.answer("J'ai de la fievre et des vomissements, est-ce grave ?", self.user)

        self.assertIn("information generale prudente", response)
        self.assertIn("Signaux d'alerte", response)

    def test_colloquial_distress_message_does_not_trigger_medication_lookup(self):
        service = ChatbotResponseService()
        service.gemini_chat.available = False

        with patch.object(service, "_answer_medicine_lookup", wraps=service._answer_medicine_lookup) as mocked_lookup:
            response = service.answer("je suis souffran mon frere", self.user)

        mocked_lookup.assert_not_called()
        self.assertIn("information generale prudente", response)
        self.assertNotIn("stocks des pharmacies", response.lower())

    def test_admin_role_uses_admin_fallback(self):
        admin_user = User.objects.create_user(
            username="admin-chatbot",
            email="admin-chatbot@example.com",
            password="testpass123",
        )
        UserProfile.objects.create(user=admin_user, role="admin", email_verified=True)
        service = ChatbotResponseService()
        service.gemini_chat.available = False

        response = service.answer("Que peux-tu faire pour moi ?", admin_user)

        self.assertIn("plateforme", response.lower())
        self.assertIn("pharmigo", response.lower())
