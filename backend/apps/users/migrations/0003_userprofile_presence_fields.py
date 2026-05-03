from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("users", "0002_userprofile_profile_image_and_admin_role"),
    ]

    operations = [
        migrations.AddField(
            model_name="userprofile",
            name="is_online",
            field=models.BooleanField(default=False),
        ),
        migrations.AddField(
            model_name="userprofile",
            name="last_seen",
            field=models.DateTimeField(blank=True, null=True),
        ),
        migrations.AddField(
            model_name="userprofile",
            name="presence_connections",
            field=models.PositiveIntegerField(default=0),
        ),
    ]
