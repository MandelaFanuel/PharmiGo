from django.conf import settings
from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):
    dependencies = [
        ("chat", "0003_chatmessage_sender_pharmacy"),
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
    ]

    operations = [
        migrations.AlterField(
            model_name="chatmessage",
            name="sender_role",
            field=models.CharField(
                choices=[("customer", "Customer"), ("patient", "Patient"), ("pharmacy", "Pharmacy")],
                default="customer",
                max_length=20,
            ),
        ),
        migrations.AddField(
            model_name="chatmessage",
            name="recipient_user",
            field=models.ForeignKey(
                blank=True,
                null=True,
                on_delete=django.db.models.deletion.SET_NULL,
                related_name="received_chat_messages",
                to=settings.AUTH_USER_MODEL,
            ),
        ),
        migrations.AddField(
            model_name="chatmessage",
            name="sender_user",
            field=models.ForeignKey(
                blank=True,
                null=True,
                on_delete=django.db.models.deletion.SET_NULL,
                related_name="sent_chat_messages",
                to=settings.AUTH_USER_MODEL,
            ),
        ),
    ]
