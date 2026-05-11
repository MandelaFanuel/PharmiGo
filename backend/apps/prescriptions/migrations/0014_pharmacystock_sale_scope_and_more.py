from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("prescriptions", "0013_pharmacystock_currency"),
    ]

    operations = [
        migrations.AddField(
            model_name="pharmacystock",
            name="sale_scope",
            field=models.CharField(
                choices=[("retail", "Detail"), ("wholesale", "Gros")],
                default="retail",
                max_length=20,
            ),
        ),
        migrations.AlterUniqueTogether(
            name="pharmacystock",
            unique_together={("pharmacy", "medication_name", "dosage", "sale_scope", "unit")},
        ),
    ]
