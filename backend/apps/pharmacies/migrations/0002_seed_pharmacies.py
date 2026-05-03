from django.db import migrations


def seed_pharmacies(apps, schema_editor):
    Pharmacy = apps.get_model("pharmacies", "Pharmacy")
    pharmacies = [
        {
            "name": "PharmiGo Centre Ville",
            "city": "Bujumbura",
            "address": "Avenue de l'Independance, Rohero",
            "phone_number": "+257 22 11 22 33",
            "email": "centreville@pharmigo.local",
            "opening_hours": "07:30 - 21:00",
            "delivery_supported": True,
        },
        {
            "name": "PharmiGo Kinindo",
            "city": "Bujumbura",
            "address": "Quartier Kinindo, Zone Sud",
            "phone_number": "+257 22 44 55 66",
            "email": "kinindo@pharmigo.local",
            "opening_hours": "08:00 - 20:00",
            "delivery_supported": False,
        },
        {
            "name": "PharmiGo Gitega",
            "city": "Gitega",
            "address": "Boulevard du Centre, Gitega",
            "phone_number": "+257 22 77 88 99",
            "email": "gitega@pharmigo.local",
            "opening_hours": "08:00 - 19:00",
            "delivery_supported": True,
        },
    ]

    for item in pharmacies:
        Pharmacy.objects.get_or_create(name=item["name"], defaults=item)


def unseed_pharmacies(apps, schema_editor):
    Pharmacy = apps.get_model("pharmacies", "Pharmacy")
    Pharmacy.objects.filter(name__startswith="PharmiGo ").delete()


class Migration(migrations.Migration):
    dependencies = [
        ("pharmacies", "0001_initial"),
    ]

    operations = [
        migrations.RunPython(seed_pharmacies, unseed_pharmacies),
    ]
