from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("pharmacies", "0008_subscriptionsystemsettings_payment_methods"),
    ]

    operations = [
        migrations.AddField(
            model_name="pharmacy",
            name="is_active",
            field=models.BooleanField(default=True),
        ),
    ]
