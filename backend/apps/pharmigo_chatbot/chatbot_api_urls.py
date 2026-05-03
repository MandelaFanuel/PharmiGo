from django.urls import path

from .views import (
    ChatbotContextView,
    ChatbotKnowledgeBaseView,
    ChatbotLearnView,
    ChatbotMessageView,
    chatbot_welcome,
    get_chatbot_messages,
)


urlpatterns = [
    path("knowledge/", ChatbotKnowledgeBaseView.as_view(), name="chatbot-knowledge"),
    path("context/", ChatbotContextView.as_view(), name="chatbot-context"),
    path("message/", ChatbotMessageView.as_view(), name="chatbot-message"),
    path("messages/", get_chatbot_messages, name="chatbot-messages"),
    path("welcome/", chatbot_welcome, name="chatbot-welcome"),
    path("learn/", ChatbotLearnView.as_view(), name="chatbot-learn"),
]
