from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("users", "0005_userprofile_email_verified_and_more"),
    ]

    operations = [
        migrations.AddConstraint(
            model_name="userprofile",
            constraint=models.UniqueConstraint(
                condition=~models.Q(phone_number=""),
                fields=("phone_number",),
                name="users_profile_phone_unique_non_blank",
            ),
        ),
    ]
