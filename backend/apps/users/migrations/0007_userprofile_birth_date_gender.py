from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("users", "0006_userprofile_unique_phone_number"),
    ]

    operations = [
        migrations.AddField(
            model_name="userprofile",
            name="birth_date",
            field=models.DateField(blank=True, null=True),
        ),
        migrations.AddField(
            model_name="userprofile",
            name="gender",
            field=models.CharField(blank=True, default="", max_length=20),
        ),
    ]
