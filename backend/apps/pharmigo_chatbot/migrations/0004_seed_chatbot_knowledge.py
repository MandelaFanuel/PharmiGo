from django.db import migrations

from apps.pharmigo_chatbot.management.commands.seed_chatbot_knowledge import KNOWLEDGE_SEED


def seed_knowledge(apps, schema_editor):
    ChatbotKnowledgeBase = apps.get_model("pharmigo_chatbot", "ChatbotKnowledgeBase")
    for item in KNOWLEDGE_SEED:
        ChatbotKnowledgeBase.objects.update_or_create(
            question=item["question"],
            defaults=item,
        )


def unseed_knowledge(apps, schema_editor):
    ChatbotKnowledgeBase = apps.get_model("pharmigo_chatbot", "ChatbotKnowledgeBase")
    questions = [item["question"] for item in KNOWLEDGE_SEED]
    ChatbotKnowledgeBase.objects.filter(question__in=questions).delete()


class Migration(migrations.Migration):
    dependencies = [
        ("pharmigo_chatbot", "0003_chatbotknowledgebase_chatbotlearningdata"),
    ]

    operations = [
        migrations.RunPython(seed_knowledge, unseed_knowledge),
    ]
