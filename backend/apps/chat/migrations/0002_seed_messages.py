from django.db import migrations


def seed_messages(apps, schema_editor):
    Pharmacy = apps.get_model("pharmacies", "Pharmacy")
    ChatMessage = apps.get_model("chat", "ChatMessage")

    pharmacy = Pharmacy.objects.filter(name="PharmiGo Centre Ville").first()
    if pharmacy is None:
        return

    ChatMessage.objects.get_or_create(
        sender_name="Equipe PharmiGo",
        message="Bonjour, nous pouvons verifier la disponibilite de vos medicaments.",
        defaults={
            "sender_role": "pharmacy",
            "pharmacy_id": pharmacy.id,
        },
    )


def unseed_messages(apps, schema_editor):
    ChatMessage = apps.get_model("chat", "ChatMessage")
    ChatMessage.objects.filter(sender_name="Equipe PharmiGo").delete()


class Migration(migrations.Migration):
    dependencies = [
        ("chat", "0001_initial"),
        ("pharmacies", "0002_seed_pharmacies"),
    ]

    operations = [
        migrations.RunPython(seed_messages, unseed_messages),
    ]
