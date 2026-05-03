from django.db import migrations, models


class Migration(migrations.Migration):
    initial = True

    dependencies = []

    operations = [
        migrations.CreateModel(
            name="Pharmacy",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("name", models.CharField(max_length=255)),
                ("city", models.CharField(max_length=120)),
                ("address", models.CharField(max_length=255)),
                ("phone_number", models.CharField(max_length=30)),
                ("email", models.EmailField(blank=True, max_length=254)),
                ("opening_hours", models.CharField(default="08:00 - 20:00", max_length=120)),
                ("delivery_supported", models.BooleanField(default=False)),
                ("latitude", models.FloatField(blank=True, null=True)),
                ("longitude", models.FloatField(blank=True, null=True)),
                ("created_at", models.DateTimeField(auto_now_add=True)),
            ],
            options={"ordering": ["name"]},
        ),
    ]
