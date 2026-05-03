from django.db import migrations


def seed_notifications(apps, schema_editor):
    Notification = apps.get_model("notifications", "Notification")
    rows = [
        {
            "title": "Service actif",
            "message": "PharmiGo est pret a recevoir des ordonnances aujourd'hui.",
            "channel": "system",
        },
        {
            "title": "Livraison disponible",
            "message": "Certaines pharmacies proposent deja la livraison locale.",
            "channel": "announcement",
        },
    ]

    for item in rows:
        Notification.objects.get_or_create(title=item["title"], defaults=item)


def unseed_notifications(apps, schema_editor):
    Notification = apps.get_model("notifications", "Notification")
    Notification.objects.filter(title__in=["Service actif", "Livraison disponible"]).delete()


class Migration(migrations.Migration):
    dependencies = [
        ("notifications", "0001_initial"),
    ]

    operations = [
        migrations.RunPython(seed_notifications, unseed_notifications),
    ]
