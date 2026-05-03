from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("pharmigo_chatbot", "0004_seed_chatbot_knowledge"),
    ]

    operations = [
        migrations.AddField(
            model_name="chatbotlearningdata",
            name="corrected_dosage",
            field=models.CharField(blank=True, max_length=100),
        ),
        migrations.AddField(
            model_name="chatbotlearningdata",
            name="corrected_form",
            field=models.CharField(blank=True, max_length=100),
        ),
        migrations.AddField(
            model_name="chatbotlearningdata",
            name="corrected_posology",
            field=models.TextField(blank=True),
        ),
        migrations.AddField(
            model_name="chatbotlearningdata",
            name="detected_dosage",
            field=models.CharField(blank=True, max_length=100),
        ),
        migrations.AddField(
            model_name="chatbotlearningdata",
            name="detected_form",
            field=models.CharField(blank=True, max_length=100),
        ),
        migrations.AddField(
            model_name="chatbotlearningdata",
            name="detected_posology",
            field=models.TextField(blank=True),
        ),
        migrations.AddField(
            model_name="chatbotlearningdata",
            name="original_gemini_text",
            field=models.TextField(blank=True),
        ),
    ]
