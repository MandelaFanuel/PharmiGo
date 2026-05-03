from django.db import migrations, models


def backfill_public_references(apps, schema_editor):
    Prescription = apps.get_model("prescriptions", "Prescription")
    for prescription_id, public_reference in Prescription.objects.order_by("id").values_list("id", "public_reference").iterator():
        if public_reference:
            continue
        Prescription.objects.filter(id=prescription_id, public_reference__isnull=True).update(
            public_reference=f"ORD-{prescription_id:06d}"
        )


class Migration(migrations.Migration):

    dependencies = [
        ("prescriptions", "0010_medication_fields_and_recommendations"),
    ]

    operations = [
        migrations.AddField(
            model_name="prescription",
            name="public_reference",
            field=models.CharField(blank=True, db_index=True, max_length=32, null=True, unique=True),
        ),
        migrations.RunPython(backfill_public_references, migrations.RunPython.noop),
    ]
