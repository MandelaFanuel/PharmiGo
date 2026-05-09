from django.contrib import admin

from .models import (
    Pharmacy,
    Medicine,
    PharmacyStock,
    Prescription,
    PrescriptionItem,
    PrescriptionHistory,
    ChatMessage,
    ChatbotKnowledgeBase,
    ChatbotLearningData,
    LearnedMedicalPattern,
    PharmiGoAISettings,
    PharmiGoAIEventLog,
)

admin.site.register(Pharmacy)
admin.site.register(Medicine)
admin.site.register(PharmacyStock)
admin.site.register(Prescription)
admin.site.register(PrescriptionItem)
admin.site.register(PrescriptionHistory)
admin.site.register(ChatMessage)
admin.site.register(ChatbotKnowledgeBase)
admin.site.register(ChatbotLearningData)
admin.site.register(LearnedMedicalPattern)
admin.site.register(PharmiGoAISettings)
admin.site.register(PharmiGoAIEventLog)
