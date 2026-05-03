from django.test import TestCase
from .models import Chat

class ChatModelTest(TestCase):
    def setUp(self):
        self.chat = Chat.objects.create(
            user_id=1,
            message="Hello, how can I help you?",
            timestamp="2023-10-01T12:00:00Z"
        )

    def test_chat_creation(self):
        self.assertEqual(self.chat.message, "Hello, how can I help you?")
        self.assertEqual(self.chat.user_id, 1)

    def test_chat_str(self):
        self.assertEqual(str(self.chat), "Hello, how can I help you?")