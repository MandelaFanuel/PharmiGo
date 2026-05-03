from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [
        ("pharmacies", "0002_seed_pharmacies"),
    ]

    operations = [
        migrations.AddField(
            model_name="pharmacy",
            name="profile_image",
            field=models.ImageField(blank=True, null=True, upload_to="pharmacies/"),
        ),
    ]
