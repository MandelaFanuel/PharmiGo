from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):
    initial = True

    dependencies = [
        ("pharmacies", "0001_initial"),
    ]

    operations = [
        migrations.CreateModel(
            name="Prescription",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("patient_name", models.CharField(max_length=255)),
                ("patient_email", models.EmailField(max_length=254)),
                ("medication_name", models.CharField(max_length=255)),
                ("dosage", models.CharField(max_length=100)),
                ("instructions", models.TextField(blank=True)),
                ("prescription_file", models.FileField(blank=True, null=True, upload_to="prescriptions/")),
                ("status", models.CharField(choices=[("submitted", "Submitted"), ("reviewed", "Reviewed")], default="submitted", max_length=20)),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                ("pharmacy", models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name="prescriptions", to="pharmacies.pharmacy")),
            ],
            options={"ordering": ["-created_at"]},
        ),
    ]
