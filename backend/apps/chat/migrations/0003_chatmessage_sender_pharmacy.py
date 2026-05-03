from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):
    dependencies = [
        ("pharmacies", "0003_pharmacy_profile_image"),
        ("chat", "0002_seed_messages"),
    ]

    operations = [
        migrations.AddField(
            model_name="chatmessage",
            name="sender_pharmacy",
            field=models.ForeignKey(
                blank=True,
                null=True,
                on_delete=django.db.models.deletion.SET_NULL,
                related_name="sent_messages",
                to="pharmacies.pharmacy",
            ),
        ),
    ]
