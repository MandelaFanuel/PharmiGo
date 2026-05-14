from django.conf import settings
from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):

    initial = True

    dependencies = [
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
    ]

    operations = [
        migrations.CreateModel(
            name="PharmiGoBugReport",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("error_type", models.CharField(max_length=255)),
                ("message", models.TextField(blank=True, default="")),
                ("severity", models.CharField(choices=[("critical", "Critique"), ("warning", "Avertissement"), ("info", "Info")], default="critical", max_length=20)),
                ("status", models.CharField(choices=[("new", "Nouveau"), ("in_progress", "En cours de correction"), ("resolved", "Résolu")], default="new", max_length=20)),
                ("module", models.CharField(blank=True, default="", max_length=80)),
                ("actor_label", models.CharField(blank=True, default="", max_length=255)),
                ("path", models.CharField(max_length=255)),
                ("method", models.CharField(blank=True, default="", max_length=16)),
                ("request_data", models.JSONField(blank=True, default=dict)),
                ("traceback", models.TextField(blank=True, default="")),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                ("updated_at", models.DateTimeField(auto_now=True)),
                ("user", models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name="sentinel_bug_reports", to=settings.AUTH_USER_MODEL)),
            ],
            options={"ordering": ["-created_at"]},
        ),
        migrations.AddIndex(
            model_name="pharmigobugreport",
            index=models.Index(fields=["created_at"], name="apps_sentin_created_a1b2c3_idx"),
        ),
        migrations.AddIndex(
            model_name="pharmigobugreport",
            index=models.Index(fields=["severity"], name="apps_sentin_severit_a1b2c3_idx"),
        ),
        migrations.AddIndex(
            model_name="pharmigobugreport",
            index=models.Index(fields=["status"], name="apps_sentin_status_a1b2c3_idx"),
        ),
        migrations.AddIndex(
            model_name="pharmigobugreport",
            index=models.Index(fields=["module"], name="apps_sentin_module_a1b2c3_idx"),
        ),
    ]
