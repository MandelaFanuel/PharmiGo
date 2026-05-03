from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):
    dependencies = [
        ("pharmacies", "0002_seed_pharmacies"),
        ("prescriptions", "0001_initial"),
    ]

    operations = [
        migrations.CreateModel(
            name="PrescriptionResponse",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("responder_name", models.CharField(max_length=120)),
                ("availability_note", models.TextField()),
                ("estimated_minutes", models.PositiveIntegerField(default=30)),
                ("total_price", models.DecimalField(decimal_places=2, default=0, max_digits=10)),
                ("status", models.CharField(choices=[("pending", "Pending"), ("quoted", "Quoted"), ("confirmed", "Confirmed")], default="quoted", max_length=20)),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                ("pharmacy", models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name="responses", to="pharmacies.pharmacy")),
                ("prescription", models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name="responses", to="prescriptions.prescription")),
            ],
            options={"ordering": ["-created_at"]},
        ),
    ]
