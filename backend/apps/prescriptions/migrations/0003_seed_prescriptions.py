from django.db import migrations


def seed_prescriptions(apps, schema_editor):
    Pharmacy = apps.get_model("pharmacies", "Pharmacy")
    Prescription = apps.get_model("prescriptions", "Prescription")
    PrescriptionResponse = apps.get_model("prescriptions", "PrescriptionResponse")

    centre = Pharmacy.objects.filter(name="PharmiGo Centre Ville").first()
    kinindo = Pharmacy.objects.filter(name="PharmiGo Kinindo").first()

    if centre is None or kinindo is None:
        return

    first, _ = Prescription.objects.get_or_create(
        patient_email="aisha@demo.local",
        medication_name="Amoxicilline 500mg",
        defaults={
            "patient_name": "Aisha N.",
            "dosage": "1 comprime matin et soir",
            "instructions": "Besoin rapide pour traitement de 7 jours",
            "pharmacy_id": centre.id,
            "status": "reviewed",
        },
    )
    second, _ = Prescription.objects.get_or_create(
        patient_email="patrick@demo.local",
        medication_name="Paracetamol 1g",
        defaults={
            "patient_name": "Patrick B.",
            "dosage": "1 comprime en cas de douleur",
            "instructions": "Verifier aussi la disponibilite du sirop pour enfant",
            "pharmacy_id": kinindo.id,
            "status": "submitted",
        },
    )

    PrescriptionResponse.objects.get_or_create(
        prescription_id=first.id,
        pharmacy_id=centre.id,
        responder_name="Equipe Centre Ville",
        defaults={
            "availability_note": "Disponible immediatement, retrait ou livraison possible.",
            "estimated_minutes": 15,
            "total_price": "12.50",
            "status": "confirmed",
        },
    )
    PrescriptionResponse.objects.get_or_create(
        prescription_id=second.id,
        pharmacy_id=kinindo.id,
        responder_name="Equipe Kinindo",
        defaults={
            "availability_note": "Paracetamol disponible. Sirop pediatrique en verification.",
            "estimated_minutes": 25,
            "total_price": "7.00",
            "status": "quoted",
        },
    )


def unseed_prescriptions(apps, schema_editor):
    Prescription = apps.get_model("prescriptions", "Prescription")
    PrescriptionResponse = apps.get_model("prescriptions", "PrescriptionResponse")

    PrescriptionResponse.objects.filter(responder_name__startswith="Equipe ").delete()
    Prescription.objects.filter(patient_email__in=["aisha@demo.local", "patrick@demo.local"]).delete()


class Migration(migrations.Migration):
    dependencies = [
        ("prescriptions", "0002_prescriptionresponse"),
    ]

    operations = [
        migrations.RunPython(seed_prescriptions, unseed_prescriptions),
    ]
