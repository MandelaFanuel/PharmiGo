from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("users", "0003_userprofile_presence_fields"),
    ]

    operations = [
        migrations.AddField(
            model_name="userprofile",
            name="last_known_ip",
            field=models.GenericIPAddressField(blank=True, null=True),
        ),
        migrations.AddField(
            model_name="userprofile",
            name="latitude",
            field=models.FloatField(blank=True, null=True),
        ),
        migrations.AddField(
            model_name="userprofile",
            name="longitude",
            field=models.FloatField(blank=True, null=True),
        ),
        migrations.AddField(
            model_name="userprofile",
            name="location_city",
            field=models.CharField(blank=True, default="", max_length=120),
        ),
        migrations.AddField(
            model_name="userprofile",
            name="location_country",
            field=models.CharField(blank=True, default="", max_length=120),
        ),
    ]
