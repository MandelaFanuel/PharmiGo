from django.db import migrations, models
import django.db.models.deletion


def add_medication_optional_fields(apps, schema_editor):
    table = "prescriptions_medicationextraction"
    existing_columns = {
        column.name
        for column in schema_editor.connection.introspection.get_table_description(
            schema_editor.connection.cursor(),
            table,
        )
    }
    if "form" not in existing_columns:
        schema_editor.execute(f'ALTER TABLE "{table}" ADD COLUMN "form" varchar(100) NULL')
    if "posology" not in existing_columns:
        schema_editor.execute(f'ALTER TABLE "{table}" ADD COLUMN "posology" text NULL')


def noop_reverse(apps, schema_editor):
    return None


class Migration(migrations.Migration):

    dependencies = [
        ("pharmacies", "0007_subscriptionsystemsettings"),
        ("prescriptions", "0009_prescriptionanalysistask_analysislog"),
    ]

    operations = [
        migrations.SeparateDatabaseAndState(
            database_operations=[
                migrations.RunPython(add_medication_optional_fields, noop_reverse),
            ],
            state_operations=[
                migrations.AddField(
                    model_name="medicationextraction",
                    name="form",
                    field=models.CharField(blank=True, max_length=100, null=True),
                ),
                migrations.AddField(
                    model_name="medicationextraction",
                    name="posology",
                    field=models.TextField(blank=True, null=True),
                ),
            ],
        ),
        migrations.CreateModel(
            name="PrescriptionRecommendation",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("availability", models.CharField(choices=[("complete", "Complete"), ("partial", "Partial")], max_length=20)),
                ("matched_items", models.JSONField(blank=True, default=list)),
                ("missing_items", models.JSONField(blank=True, default=list)),
                ("estimated_total_price", models.DecimalField(decimal_places=2, default=0.0, max_digits=12)),
                ("distance_km", models.FloatField(blank=True, null=True)),
                ("score", models.FloatField(default=0.0)),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                ("updated_at", models.DateTimeField(auto_now=True)),
                ("pharmacy", models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name="prescription_recommendations", to="pharmacies.pharmacy")),
                ("prescription", models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name="recommendations", to="prescriptions.prescription")),
            ],
            options={
                "ordering": ["-score", "distance_km", "pharmacy__name"],
                "unique_together": {("prescription", "pharmacy")},
            },
        ),
    ]
