from django.urls import path, include
from rest_framework.routers import DefaultRouter

from .views import (
    PharmacyViewSet,
    MedicineViewSet,
    PharmacyStockViewSet,
    PrescriptionViewSet,
    ChatbotKnowledgeBaseView,
    ChatbotContextView,
    ChatbotMessageView,
    ChatbotLearnView,
    chatbot_welcome,
    chatbot_message,
    get_chatbot_messages,
    populate_medicine_database,
)

router = DefaultRouter()
router.register("pharmacies", PharmacyViewSet)
router.register("medicines", MedicineViewSet)
router.register("stocks", PharmacyStockViewSet)
router.register("prescriptions", PrescriptionViewSet)

urlpatterns = [
    path("", include(router.urls)),
    path("knowledge/", ChatbotKnowledgeBaseView.as_view()),
    path("context/", ChatbotContextView.as_view()),
    path("message/", ChatbotMessageView.as_view()),
    path("learn/", ChatbotLearnView.as_view()),
    path("chatbot/welcome/", chatbot_welcome),
    path("chatbot/message/", chatbot_message),
    path("chatbot/messages/", get_chatbot_messages),
    path("admin/populate-medicines/", populate_medicine_database),
]
