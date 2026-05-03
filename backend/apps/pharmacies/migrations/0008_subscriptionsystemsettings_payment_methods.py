from django.db import migrations, models

from apps.pharmacies.payment_config import get_default_payment_methods


class Migration(migrations.Migration):

    dependencies = [
        ("pharmacies", "0007_subscriptionsystemsettings"),
    ]

    operations = [
        migrations.AddField(
            model_name="subscriptionsystemsettings",
            name="payment_methods",
            field=models.JSONField(default=get_default_payment_methods),
        ),
    ]
