from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("pharmacies", "0010_pharmacy_is_verified"),
    ]

    operations = [
        migrations.AddField(
            model_name="subscriptionpayment",
            name="payer_address",
            field=models.CharField(blank=True, default="", max_length=255),
        ),
        migrations.AddField(
            model_name="subscriptionpayment",
            name="payer_name",
            field=models.CharField(blank=True, default="", max_length=120),
        ),
    ]
