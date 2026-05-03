from django.conf import settings
from django.db import migrations, models


class Migration(migrations.Migration):
    initial = True

    dependencies = [
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
        ("pharmacies", "0001_initial"),
    ]

    operations = [
        migrations.CreateModel(
            name="UserProfile",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("role", models.CharField(choices=[("patient", "Patient"), ("pharmacy", "Pharmacy")], default="patient", max_length=20)),
                ("phone_number", models.CharField(blank=True, max_length=30)),
                ("whatsapp_number", models.CharField(blank=True, max_length=30)),
                ("address", models.CharField(blank=True, max_length=255)),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                ("pharmacy", models.OneToOneField(blank=True, null=True, on_delete=models.deletion.SET_NULL, related_name="user_profile", to="pharmacies.pharmacy")),
                ("user", models.OneToOneField(on_delete=models.deletion.CASCADE, related_name="profile", to=settings.AUTH_USER_MODEL)),
            ],
            options={"ordering": ["-created_at"]},
        ),
    ]
