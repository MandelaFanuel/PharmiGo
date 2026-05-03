# Generated for resilient schema reconciliation across legacy and fresh databases.

from django.conf import settings
from django.db import migrations, models
from django.db.utils import OperationalError, ProgrammingError
import django.db.models.deletion


def sync_prescription_schema(apps, schema_editor):
    Prescription = apps.get_model("prescriptions", "Prescription")
    from apps.prescriptions.models import MedicationExtraction, PharmacyStock, PrescriptionStatusHistory

    connection = schema_editor.connection
    existing_tables = set(connection.introspection.table_names())

    def existing_columns(table_name):
        with connection.cursor() as cursor:
            description = connection.introspection.get_table_description(cursor, table_name)
        return {column.name for column in description}

    prescription_table = Prescription._meta.db_table
    prescription_columns = existing_columns(prescription_table)

    field_definitions = {
        "confidence_score": models.FloatField(default=0.0),
        "estimated_arrival": models.DateTimeField(blank=True, null=True),
        "notes": models.TextField(blank=True, null=True),
        "ocr_text": models.TextField(blank=True, null=True),
        "patient_confirmed_at": models.DateTimeField(blank=True, null=True),
        "prescription_image": models.ImageField(blank=True, null=True, upload_to="prescriptions/images/"),
        "served_at": models.DateTimeField(blank=True, null=True),
        "total_amount": models.DecimalField(blank=True, decimal_places=2, max_digits=10, null=True),
        "updated_at": models.DateTimeField(auto_now=True),
    }

    def safe_add_field(model, field_name, known_columns):
        if field_name in known_columns:
            return
        try:
            field = field_definitions[field_name]
            field.set_attributes_from_name(field_name)
            schema_editor.add_field(model, field)
            known_columns.add(field_name)
        except (OperationalError, ProgrammingError) as exc:
            message = str(exc).lower()
            if "duplicate column name" not in message and "already exists" not in message:
                raise
            known_columns.add(field_name)

    for field_name in [
        "confidence_score",
        "estimated_arrival",
        "notes",
        "ocr_text",
        "patient_confirmed_at",
        "prescription_image",
        "served_at",
        "total_amount",
        "updated_at",
    ]:
        safe_add_field(Prescription, field_name, prescription_columns)

    for model in [PrescriptionStatusHistory, MedicationExtraction, PharmacyStock]:
        if model._meta.db_table not in existing_tables:
            schema_editor.create_model(model)
            existing_tables.add(model._meta.db_table)


class Migration(migrations.Migration):

    dependencies = [
        ("pharmacies", "0005_pharmacycontact"),
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
        ("prescriptions", "0007_add_intelligent_fields"),
    ]

    operations = [
        migrations.SeparateDatabaseAndState(
            database_operations=[
                migrations.RunPython(sync_prescription_schema, migrations.RunPython.noop),
            ],
            state_operations=[
                migrations.AddField(
                    model_name="prescription",
                    name="confidence_score",
                    field=models.FloatField(default=0.0),
                ),
                migrations.AddField(
                    model_name="prescription",
                    name="estimated_arrival",
                    field=models.DateTimeField(blank=True, null=True),
                ),
                migrations.AddField(
                    model_name="prescription",
                    name="notes",
                    field=models.TextField(blank=True, null=True),
                ),
                migrations.AddField(
                    model_name="prescription",
                    name="ocr_text",
                    field=models.TextField(blank=True, null=True),
                ),
                migrations.AddField(
                    model_name="prescription",
                    name="patient_confirmed_at",
                    field=models.DateTimeField(blank=True, null=True),
                ),
                migrations.AddField(
                    model_name="prescription",
                    name="prescription_image",
                    field=models.ImageField(blank=True, null=True, upload_to="prescriptions/images/"),
                ),
                migrations.AddField(
                    model_name="prescription",
                    name="served_at",
                    field=models.DateTimeField(blank=True, null=True),
                ),
                migrations.AddField(
                    model_name="prescription",
                    name="total_amount",
                    field=models.DecimalField(blank=True, decimal_places=2, max_digits=10, null=True),
                ),
                migrations.AddField(
                    model_name="prescription",
                    name="updated_at",
                    field=models.DateTimeField(auto_now=True),
                ),
                migrations.AlterField(
                    model_name="prescription",
                    name="dosage",
                    field=models.CharField(blank=True, max_length=100, null=True),
                ),
                migrations.AlterField(
                    model_name="prescription",
                    name="instructions",
                    field=models.TextField(blank=True, null=True),
                ),
                migrations.AlterField(
                    model_name="prescription",
                    name="medication_name",
                    field=models.CharField(blank=True, max_length=255, null=True),
                ),
                migrations.AlterField(
                    model_name="prescription",
                    name="prescription_file",
                    field=models.FileField(blank=True, null=True, upload_to="prescriptions/files/"),
                ),
                migrations.AlterField(
                    model_name="prescription",
                    name="status",
                    field=models.CharField(
                        choices=[
                            ("uploaded", "Uploadée"),
                            ("analyzing", "Analyse en cours"),
                            ("confirmation_pending", "Confirmation en attente"),
                            ("confirmed", "Confirmée"),
                            ("searching", "Recherche pharmacies"),
                            ("pharmacy_selected", "Pharmacie sélectionnée"),
                            ("preparing", "En préparation"),
                            ("ready", "Prête"),
                            ("served", "Servie"),
                            ("patient_confirmed", "Confirmée patient"),
                            ("completed", "Terminée"),
                            ("cancelled", "Annulée"),
                            ("error", "Erreur"),
                            ("submitted", "Submitted"),
                            ("reviewed", "Reviewed"),
                        ],
                        default="uploaded",
                        max_length=50,
                    ),
                ),
                migrations.CreateModel(
                    name="PrescriptionStatusHistory",
                    fields=[
                        ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                        ("status", models.CharField(max_length=50)),
                        ("changed_at", models.DateTimeField(auto_now_add=True)),
                        ("notes", models.TextField(blank=True, null=True)),
                        (
                            "changed_by",
                            models.ForeignKey(
                                blank=True,
                                null=True,
                                on_delete=django.db.models.deletion.SET_NULL,
                                related_name="prescription_status_changes",
                                to=settings.AUTH_USER_MODEL,
                            ),
                        ),
                        (
                            "prescription",
                            models.ForeignKey(
                                on_delete=django.db.models.deletion.CASCADE,
                                related_name="status_history",
                                to="prescriptions.prescription",
                            ),
                        ),
                    ],
                    options={"ordering": ["-changed_at"]},
                ),
                migrations.CreateModel(
                    name="MedicationExtraction",
                    fields=[
                        ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                        ("name", models.CharField(max_length=255)),
                        ("generic_name", models.CharField(blank=True, max_length=255, null=True)),
                        ("dosage", models.CharField(blank=True, max_length=100, null=True)),
                        ("quantity", models.IntegerField(default=1)),
                        ("unit", models.CharField(default="comprimés", max_length=50)),
                        ("confidence", models.FloatField(default=0.0)),
                        ("confirmed", models.BooleanField(default=False)),
                        ("alternatives", models.JSONField(blank=True, default=list)),
                        ("requires_prescription", models.BooleanField(default=True)),
                        ("created_at", models.DateTimeField(auto_now_add=True)),
                        (
                            "prescription",
                            models.ForeignKey(
                                on_delete=django.db.models.deletion.CASCADE,
                                related_name="extracted_medications",
                                to="prescriptions.prescription",
                            ),
                        ),
                    ],
                    options={"ordering": ["-confidence"]},
                ),
                migrations.CreateModel(
                    name="PharmacyStock",
                    fields=[
                        ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                        ("medication_name", models.CharField(max_length=255)),
                        ("generic_name", models.CharField(blank=True, max_length=255, null=True)),
                        ("dosage", models.CharField(blank=True, max_length=100, null=True)),
                        ("quantity", models.IntegerField(default=0)),
                        ("unit", models.CharField(default="comprimés", max_length=50)),
                        ("price", models.DecimalField(decimal_places=2, default=0.0, max_digits=10)),
                        ("last_updated", models.DateTimeField(auto_now=True)),
                        ("is_available", models.BooleanField(default=True)),
                        (
                            "pharmacy",
                            models.ForeignKey(
                                on_delete=django.db.models.deletion.CASCADE,
                                related_name="stock",
                                to="pharmacies.pharmacy",
                            ),
                        ),
                    ],
                    options={
                        "ordering": ["-last_updated"],
                        "unique_together": {("pharmacy", "medication_name", "dosage")},
                    },
                ),
            ],
        ),
    ]
