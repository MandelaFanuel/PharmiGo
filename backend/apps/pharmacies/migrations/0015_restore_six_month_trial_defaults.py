from datetime import timedelta

from django.db import migrations, models
from django.utils import timezone


def restore_six_month_trial_defaults(apps, schema_editor):
    SubscriptionSystemSettings = apps.get_model("pharmacies", "SubscriptionSystemSettings")
    PharmacySubscription = apps.get_model("pharmacies", "PharmacySubscription")

    settings_obj, _ = SubscriptionSystemSettings.objects.get_or_create(
        pk=1,
        defaults={"trial_period_days": 180},
    )

    if settings_obj.updated_by_id is None and settings_obj.trial_period_days == 30:
        settings_obj.trial_period_days = 180
        settings_obj.save(update_fields=["trial_period_days", "updated_at"])

    active_trial_subscriptions = PharmacySubscription.objects.filter(
        subscription_status="trial",
        is_trial_active=True,
    )
    for subscription in active_trial_subscriptions.iterator():
        trial_start = subscription.trial_start_date or timezone.now()
        expected_end = trial_start + timedelta(days=settings_obj.trial_period_days or 180)
        if subscription.trial_end_date != expected_end:
            subscription.trial_end_date = expected_end
            subscription.save(update_fields=["trial_end_date", "updated_at"])


class Migration(migrations.Migration):
    dependencies = [
        ("pharmacies", "0014_pharmacyreferral_pharmacy_referral_code_and_more"),
    ]

    operations = [
        migrations.AlterField(
            model_name="subscriptionsystemsettings",
            name="trial_period_days",
            field=models.PositiveIntegerField(default=180),
        ),
        migrations.RunPython(restore_six_month_trial_defaults, migrations.RunPython.noop),
    ]
