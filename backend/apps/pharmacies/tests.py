from pathlib import Path
from tempfile import TemporaryDirectory
from datetime import timedelta

from django.contrib.auth import get_user_model
from django.core.files.uploadedfile import SimpleUploadedFile
from django.core.management import call_command
from django.test import SimpleTestCase
from django.utils import timezone
from rest_framework.test import APITestCase

from apps.common.public_storage import PharmigoPublicMediaStorage
from apps.notifications.models import Notification
from apps.pharmacies.models import Pharmacy, PharmacySubscription, SubscriptionPayment, SubscriptionSystemSettings
from apps.pharmacies.models import PharmacyReferral, PharmacyReferralDeviceLog, PharmacyReferralFraudAlert
from apps.pharmacies.services.rewards import (
    _evaluate_fraud,
    build_pharmacy_reward_payload,
    safe_mark_payment_validated_for_pharmacy,
    safe_record_activity_for_referral,
    safe_register_referral_from_code,
)
from apps.pharmacies.services.access import pharmacy_has_platform_access
from apps.prescriptions.models import MedicationExtraction, PharmacyStock, Prescription, PrescriptionResponse
from apps.users.models import UserProfile
from apps.users.serializers import DEFAULT_ADMIN_EMAIL

User = get_user_model()


class PublicMediaStorageTests(SimpleTestCase):
    def test_same_stem_suffix_fallback_finds_committed_public_pharmacy_image(self):
        with TemporaryDirectory() as current_dir, TemporaryDirectory() as legacy_dir:
            current_root = Path(current_dir)
            legacy_root = Path(legacy_dir)
            existing_file = legacy_root / "pharmacies" / "Screenshot_20250729-145733_Chrome.jpg"
            existing_file.parent.mkdir(parents=True, exist_ok=True)
            existing_file.write_bytes(b"pharmacy-image")

            storage = PharmigoPublicMediaStorage()
            storage.base_location = str(current_root)
            storage.legacy_location = legacy_root

            requested_name = "pharmacies/Screenshot_20250729-145733_Chrome_QhmxhdU.jpg"

            self.assertTrue(storage.exists(requested_name))
            self.assertEqual(storage.path(requested_name), str(existing_file))
            with storage.open(requested_name, "rb") as handle:
                self.assertEqual(handle.read(), b"pharmacy-image")


class PharmacySubscriptionApiTests(APITestCase):
    def setUp(self):
        self.user = User.objects.create_user(username="pharmacy-user", password="secret123")
        self.pharmacy = Pharmacy.objects.create(
            name="Pharmacie Centrale",
            city="Bujumbura",
            address="Rohero I",
            phone_number="+25761000004",
        )
        UserProfile.objects.create(
            user=self.user,
            role="pharmacy",
            phone_number="+25761000004",
            whatsapp_number="+25761000004",
            address="Rohero I",
            pharmacy=self.pharmacy,
        )
        self.client.force_authenticate(user=self.user)

    def test_subscription_endpoint_returns_trial_and_payment_details(self):
        response = self.client.get("/api/pharmacies/subscription/")

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data["subscription_status"], "trial")
        self.assertIn("payment_details_burundi", response.data)
        self.assertTrue(PharmacySubscription.objects.filter(pharmacy=self.pharmacy).exists())

    def test_subscription_settings_default_trial_period_is_six_months(self):
        settings_obj = SubscriptionSystemSettings.get_solo()

        self.assertEqual(settings_obj.trial_period_days, 180)

    def test_subscription_activity_check_respects_trial_end(self):
        subscription = PharmacySubscription.objects.create(
            pharmacy=self.pharmacy,
            trial_end_date=timezone.now() + timedelta(days=30),
        )

        self.assertTrue(subscription.is_active())

    def test_active_subscription_reopens_access_even_if_verified_flag_was_false(self):
        subscription = PharmacySubscription.objects.create(
            pharmacy=self.pharmacy,
            subscription_status="active",
            is_trial_active=False,
            trial_end_date=timezone.now() + timedelta(days=30),
            next_payment_due_date=timezone.now() + timedelta(days=30),
        )
        self.pharmacy.is_verified = False
        self.pharmacy.save(update_fields=["is_verified"])

        self.assertTrue(subscription.is_active())
        self.assertTrue(pharmacy_has_platform_access(self.pharmacy))

    def test_expired_active_subscription_blocks_access_again_after_due_date(self):
        subscription = PharmacySubscription.objects.create(
            pharmacy=self.pharmacy,
            subscription_status="active",
            is_trial_active=False,
            trial_end_date=timezone.now() + timedelta(days=30),
            next_payment_due_date=timezone.now() - timedelta(days=1),
        )

        self.assertFalse(subscription.is_active())
        self.assertFalse(pharmacy_has_platform_access(self.pharmacy))

    def test_trial_pharmacy_is_visible_but_not_marked_verified(self):
        PharmacySubscription.objects.create(
            pharmacy=self.pharmacy,
            subscription_status="trial",
            is_trial_active=True,
            trial_end_date=timezone.now() + timedelta(days=30),
        )

        self.client.force_authenticate(user=None)
        response = self.client.get("/api/pharmacies/")

        self.assertEqual(response.status_code, 200)
        row = next(item for item in response.data if item["id"] == self.pharmacy.id)
        self.assertEqual(row["subscription_status"], "trial")
        self.assertFalse(row["is_official"])

    def test_active_paid_pharmacy_is_visible_and_marked_verified_even_if_flag_was_stale(self):
        PharmacySubscription.objects.create(
            pharmacy=self.pharmacy,
            subscription_status="active",
            is_trial_active=False,
            trial_end_date=timezone.now() + timedelta(days=30),
            next_payment_due_date=timezone.now() + timedelta(days=30),
        )
        self.pharmacy.is_verified = False
        self.pharmacy.save(update_fields=["is_verified"])

        self.client.force_authenticate(user=None)
        response = self.client.get("/api/pharmacies/")

        self.assertEqual(response.status_code, 200)
        row = next(item for item in response.data if item["id"] == self.pharmacy.id)
        self.assertEqual(row["subscription_status"], "active")
        self.assertTrue(row["is_official"])
        self.pharmacy.refresh_from_db()
        self.assertTrue(self.pharmacy.is_verified)

    def test_admin_can_update_global_trial_duration(self):
        admin_user = User.objects.create_user(
            username="admin",
            email=DEFAULT_ADMIN_EMAIL,
            password="secret123",
            is_staff=True,
            is_superuser=True,
        )
        subscription = PharmacySubscription.objects.create(
            pharmacy=self.pharmacy,
            trial_start_date=timezone.now(),
            trial_end_date=timezone.now() + timedelta(days=180),
            subscription_status="trial",
            is_trial_active=True,
        )

        self.client.force_authenticate(user=admin_user)
        response = self.client.patch(
            "/api/admin/dashboard/",
            {"trial_period_days": 90},
            format="json",
        )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data["settings"]["trial_period_days"], 90)

        settings_obj = SubscriptionSystemSettings.get_solo()
        subscription.refresh_from_db()
        self.assertEqual(settings_obj.trial_period_days, 90)
        self.assertEqual((subscription.trial_end_date - subscription.trial_start_date).days, 90)

    def test_admin_dashboard_exposes_lost_prescriptions_for_limited_pharmacies(self):
        admin_user = User.objects.create_user(
            username="admin-dashboard",
            email="admin-dashboard@pharmigo.com",
            password="secret123",
            is_staff=True,
            is_superuser=True,
        )
        PharmacySubscription.objects.update_or_create(
            pharmacy=self.pharmacy,
            defaults={
                "subscription_status": "expired",
                "is_trial_active": False,
                "trial_end_date": timezone.now() - timedelta(days=1),
            },
        )
        patient_user = User.objects.create_user(username="patient-lost", password="secret123")
        UserProfile.objects.create(user=patient_user, role="patient", phone_number="+25761000046", email_verified=True)
        prescription = Prescription.objects.create(
            patient_name="Patient Lost",
            patient_email="lost@example.com",
            patient_user=patient_user,
            status="confirmed",
        )
        MedicationExtraction.objects.create(
            prescription=prescription,
            name="Paracetamol",
            dosage="500mg",
            quantity=1,
            confirmed=True,
        )
        PharmacyStock.objects.create(
            pharmacy=self.pharmacy,
            medication_name="Paracetamol",
            dosage="500mg",
            quantity=5,
            is_available=True,
        )

        self.client.force_authenticate(user=admin_user)
        response = self.client.get("/api/admin/dashboard/")

        self.assertEqual(response.status_code, 200)
        self.assertGreaterEqual(response.data["summary"]["lost_prescriptions_total"], 1)
        subscription_row = next(item for item in response.data["subscriptions"] if item["pharmacy_id"] == self.pharmacy.id)
        self.assertGreaterEqual(subscription_row["lost_prescriptions_count"], 1)

    def test_profile_exposes_registration_timestamps_and_filters_old_history(self):
        now = timezone.now()
        UserProfile.objects.filter(pk=self.user.profile.pk).update(created_at=now)
        Pharmacy.objects.filter(pk=self.pharmacy.pk).update(created_at=now)

        old_prescription = Prescription.objects.create(
            patient_name="Patient Ancien",
            patient_email="ancien@example.com",
            medication_name="Paracetamol",
            status="confirmed",
        )
        new_prescription = Prescription.objects.create(
            patient_name="Patient Nouveau",
            patient_email="nouveau@example.com",
            medication_name="Amoxicilline",
            status="confirmed",
        )

        Prescription.objects.filter(pk=old_prescription.pk).update(created_at=now - timedelta(days=2))
        Prescription.objects.filter(pk=new_prescription.pk).update(created_at=now + timedelta(minutes=1))

        old_response = PrescriptionResponse.objects.create(
            prescription=old_prescription,
            pharmacy=self.pharmacy,
            responder_name=self.pharmacy.name,
            availability_note="Ancienne reponse",
            estimated_minutes=30,
            total_price=1000,
            status="quoted",
        )
        new_response = PrescriptionResponse.objects.create(
            prescription=new_prescription,
            pharmacy=self.pharmacy,
            responder_name=self.pharmacy.name,
            availability_note="Nouvelle reponse",
            estimated_minutes=20,
            total_price=1500,
            status="quoted",
        )

        PrescriptionResponse.objects.filter(pk=old_response.pk).update(created_at=now - timedelta(days=2))
        PrescriptionResponse.objects.filter(pk=new_response.pk).update(created_at=now + timedelta(minutes=1))

        response = self.client.get("/api/profile/")

        self.assertEqual(response.status_code, 200)
        self.assertIn("created_at", response.data["profile"])
        self.assertIn("pharmacy_created_at", response.data["profile"])
        self.assertEqual(len(response.data["history"]["responses"]), 1)
        self.assertEqual(response.data["history"]["responses"][0]["prescription"], new_prescription.id)

    def test_pharmacy_profile_patch_can_store_profile_image(self):
        uploaded = SimpleUploadedFile("pharmacy.png", b"fake-pharmacy-image", content_type="image/png")

        response = self.client.patch(
            "/api/profile/",
            {
                "pharmacy_name": self.pharmacy.name,
                "address": self.pharmacy.address,
                "city": self.pharmacy.city,
                "phone_number": self.pharmacy.phone_number,
                "email": "centrale@example.com",
                "opening_hours": "08:00 - 20:00",
                "delivery_supported": "false",
                "pharmacy_image": uploaded,
            },
            format="multipart",
        )

        self.assertEqual(response.status_code, 200)
        self.pharmacy.refresh_from_db()
        self.assertTrue(bool(self.pharmacy.profile_image))
        self.assertEqual(self.pharmacy.profile_image_blob, b"fake-pharmacy-image")
        self.assertEqual(self.pharmacy.profile_image_content_type, "image/png")
        self.assertEqual(self.pharmacy.profile_image_original_name, "pharmacy.png")
        self.assertIn("/api/pharmacies/", response.data["profile"]["pharmacy_image"])

    def test_pharmacy_profile_image_view_can_fallback_to_database_blob(self):
        self.pharmacy.profile_image = "pharmacies/missing-karibu.png"
        self.pharmacy.profile_image_blob = b"fallback-image"
        self.pharmacy.profile_image_content_type = "image/png"
        self.pharmacy.profile_image_original_name = "karibu.png"
        self.pharmacy.save(update_fields=["profile_image", "profile_image_blob", "profile_image_content_type", "profile_image_original_name"])

        response = self.client.get(f"/api/pharmacies/{self.pharmacy.pk}/profile-image/")

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response["Content-Type"], "image/png")
        self.assertEqual(response.content, b"fallback-image")

    def test_pharmacy_profile_patch_can_update_sales_modes(self):
        response = self.client.patch(
            "/api/profile/",
            {
                "pharmacy_name": self.pharmacy.name,
                "address": self.pharmacy.address,
                "city": self.pharmacy.city,
                "phone_number": self.pharmacy.phone_number,
                "email": "centrale@example.com",
                "opening_hours": "08:00 - 20:00",
                "delivery_supported": "false",
                "wholesale_supported": "true",
                "retail_supported": "false",
            },
            format="multipart",
        )

        self.assertEqual(response.status_code, 200)
        self.pharmacy.refresh_from_db()
        self.assertTrue(self.pharmacy.wholesale_supported)
        self.assertFalse(self.pharmacy.retail_supported)

    def test_pharmacy_stock_creation_uses_phone_currency_by_default(self):
        response = self.client.post(
            "/api/prescriptions/pharmacy-stock/",
            {
                "medication_name": "Paracetamol",
                "dosage": "500mg",
                "quantity": 4,
                "sale_scope": "retail",
                "unit": "comprimé",
                "price": "2500",
                "is_available": True,
            },
            format="json",
        )

        self.assertEqual(response.status_code, 201)
        self.assertEqual(response.data["currency"], "BIF")

    def test_pharmacy_stock_creation_rejects_currency_not_matching_phone_country(self):
        response = self.client.post(
            "/api/prescriptions/pharmacy-stock/",
            {
                "medication_name": "Amoxicilline",
                "dosage": "500mg",
                "quantity": 2,
                "sale_scope": "retail",
                "unit": "comprimé",
                "price": "1500",
                "currency": "TSH",
                "is_available": True,
            },
            format="json",
        )

        self.assertEqual(response.status_code, 400)
        self.assertIn("currency", response.data)

    def test_wholesale_only_pharmacy_stock_requires_wholesale_sale_scope(self):
        self.pharmacy.wholesale_supported = True
        self.pharmacy.retail_supported = False
        self.pharmacy.save(update_fields=["wholesale_supported", "retail_supported"])

        response = self.client.post(
            "/api/prescriptions/pharmacy-stock/",
            {
                "medication_name": "Ceftriaxone",
                "dosage": "1g",
                "quantity": 2,
                "sale_scope": "retail",
                "unit": "flacon",
                "price": "45000",
                "is_available": True,
            },
            format="json",
        )

        self.assertEqual(response.status_code, 400)
        self.assertIn("sale_scope", response.data)

    def test_wholesale_only_pharmacy_stock_accepts_carton_pricing(self):
        self.pharmacy.wholesale_supported = True
        self.pharmacy.retail_supported = False
        self.pharmacy.save(update_fields=["wholesale_supported", "retail_supported"])

        response = self.client.post(
            "/api/prescriptions/pharmacy-stock/",
            {
                "medication_name": "Ceftriaxone",
                "dosage": "1g",
                "quantity": 3,
                "sale_scope": "wholesale",
                "unit": "carton",
                "price": "120000",
                "is_available": True,
            },
            format="json",
        )

        self.assertEqual(response.status_code, 201)
        self.assertEqual(response.data["sale_scope"], "wholesale")
        self.assertEqual(response.data["unit"], "carton")

    def test_pharmacy_profile_patch_requires_at_least_one_sales_mode(self):
        response = self.client.patch(
            "/api/profile/",
            {
                "pharmacy_name": self.pharmacy.name,
                "address": self.pharmacy.address,
                "city": self.pharmacy.city,
                "phone_number": self.pharmacy.phone_number,
                "email": "centrale@example.com",
                "opening_hours": "08:00 - 20:00",
                "delivery_supported": "false",
                "wholesale_supported": "false",
                "retail_supported": "false",
            },
            format="multipart",
        )

        self.assertEqual(response.status_code, 400)
        self.assertIn("retail_supported", response.data)

    def test_subscription_payment_submission_notifies_admin(self):
        admin_user = User.objects.create_user(
            username="admin-payment",
            email="admin-payment@pharmigo.com",
            password="secret123",
            is_staff=True,
            is_superuser=True,
        )

        response = self.client.post(
            "/api/pharmacies/payments/",
            {
                "amount_usd": "5.00",
                "amount_bif": "15000",
                "currency": "BIF",
                "payment_method": "lumicash",
                "payer_name": "Pharmacie Centrale",
                "payer_address": "Rohero I",
                "sender_phone": "+25761000004",
                "receiver_phone": "+25762000000",
                "transaction_reference": "TX-ABO-001",
                "payment_status": "pending",
                "payment_month": "2026-05-01",
            },
            format="json",
        )

        self.assertEqual(response.status_code, 201)
        self.assertTrue(
            Notification.objects.filter(
                recipient_user=admin_user,
                channel="payments:admin",
                title="Nouveau paiement d'abonnement",
            ).exists()
        )

    def test_admin_payment_verification_disables_trial_and_activates_monthly_subscription(self):
        admin_user = User.objects.create_user(
            username="admin-verify-payment",
            email="admin-verify-payment@pharmigo.com",
            password="secret123",
            is_staff=True,
            is_superuser=True,
        )
        subscription = PharmacySubscription.objects.create(
            pharmacy=self.pharmacy,
            trial_start_date=timezone.now(),
            trial_end_date=timezone.now() + timedelta(days=180),
            subscription_status="trial",
            is_trial_active=True,
        )
        payment = SubscriptionPayment.objects.create(
            pharmacy=self.pharmacy,
            amount_usd="5.00",
            amount_bif="14905.40",
            currency="BIF",
            payment_method="lumicash",
            payer_name="Karibu",
            payer_address="Gitega",
            sender_phone="+25761666666",
            receiver_phone="+25769096758",
            transaction_reference="TX-VERIFY-001",
            payment_status="pending",
            payment_month=timezone.localdate().replace(day=1),
        )

        self.client.force_authenticate(user=admin_user)
        response = self.client.patch(
            f"/api/pharmacies/payments/{payment.id}/",
            {"payment_status": "verified"},
            format="json",
        )

        self.assertEqual(response.status_code, 200)
        payment.refresh_from_db()
        subscription.refresh_from_db()
        self.assertEqual(payment.payment_status, "verified")
        self.assertEqual(payment.verified_by_id, admin_user.id)
        self.assertEqual(subscription.subscription_status, "active")
        self.assertFalse(subscription.is_trial_active)
        self.assertIsNotNone(subscription.last_payment_date)
        self.assertIsNotNone(subscription.next_payment_due_date)
        self.assertLessEqual(subscription.trial_end_date, timezone.now())
        self.assertTrue(pharmacy_has_platform_access(self.pharmacy))

    def test_admin_can_open_payment_proof_inside_protected_endpoint(self):
        admin_user = User.objects.create_user(
            username="admin-proof",
            email="admin-proof@pharmigo.com",
            password="secret123",
            is_staff=True,
            is_superuser=True,
        )
        proof_image = SimpleUploadedFile("proof.png", b"fake-proof-image", content_type="image/png")
        payment = SubscriptionPayment.objects.create(
            pharmacy=self.pharmacy,
            amount_usd="5.00",
            amount_bif="14905.40",
            currency="BIF",
            payment_method="lumicash",
            payer_name="Karibu",
            payer_address="Gitega",
            sender_phone="+25761666666",
            receiver_phone="+25769096758",
            transaction_reference="TX-PROOF-001",
            payment_status="pending",
            payment_month=timezone.localdate().replace(day=1),
            proof_image=proof_image,
        )

        self.client.force_authenticate(user=admin_user)
        response = self.client.get(f"/api/pharmacies/payments/{payment.id}/proof/")

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response["Content-Type"], "image/png")
        self.assertIn("inline;", response["Content-Disposition"])

    def test_expired_pharmacy_response_submission_is_blocked_with_payment_wall_message(self):
        PharmacySubscription.objects.update_or_create(
            pharmacy=self.pharmacy,
            defaults={
                "subscription_status": "expired",
                "is_trial_active": False,
                "trial_end_date": timezone.now() - timedelta(days=1),
            },
        )
        patient_user = User.objects.create_user(username="patient-for-response", password="secret123")
        UserProfile.objects.create(user=patient_user, role="patient", phone_number="+25761000044", email_verified=True)
        prescription = Prescription.objects.create(
            patient_name="Patient Test",
            patient_email="patient@example.com",
            patient_user=patient_user,
            status="confirmed",
        )

        response = self.client.post(
            "/api/prescription-responses/",
            {
                "prescription": prescription.id,
                "availability_note": "Disponible",
                "estimated_minutes": 20,
                "total_price": "2500",
                "status": "quoted",
            },
            format="json",
        )

        self.assertEqual(response.status_code, 403)
        self.assertEqual(
            response.data["detail"],
            "Votre période d'essai est terminée, veuillez activer votre abonnement pour continuer à bénéficier de toutes les fonctionnalités.",
        )

    def test_notify_expired_pharmacies_command_creates_upsell_notification(self):
        PharmacySubscription.objects.update_or_create(
            pharmacy=self.pharmacy,
            defaults={
                "subscription_status": "expired",
                "is_trial_active": False,
                "trial_end_date": timezone.now() - timedelta(days=1),
            },
        )
        patient_user = User.objects.create_user(username="patient-stock-match", password="secret123")
        UserProfile.objects.create(user=patient_user, role="patient", phone_number="+25761000045", email_verified=True)
        prescription = Prescription.objects.create(
            patient_name="Patient Match",
            patient_email="match@example.com",
            patient_user=patient_user,
            status="confirmed",
        )
        MedicationExtraction.objects.create(
            prescription=prescription,
            name="Paracetamol",
            dosage="500mg",
            quantity=1,
            confirmed=True,
        )
        PharmacyStock.objects.create(
            pharmacy=self.pharmacy,
            medication_name="Paracetamol",
            dosage="500mg",
            quantity=10,
            is_available=True,
        )

        call_command("notify_expired_pharmacies")

        self.assertTrue(
            Notification.objects.filter(
                recipient_pharmacy=self.pharmacy,
                title="Opportunités PharmiGo en attente",
            ).exists()
        )

    def test_referral_registration_from_code_creates_pending_payment_link(self):
        referrer = Pharmacy.objects.create(
            name="Pharmacie Ambassadeur",
            city="Bujumbura",
            address="Rohero II",
            phone_number="+25761000999",
            email="ambassadeur@example.com",
        )
        safe_register_referral_from_code(referral_code=referrer.referral_code, referee=self.pharmacy)

        referral = PharmacyReferral.objects.get(referee=self.pharmacy)
        self.assertEqual(referral.referrer_id, referrer.id)
        self.assertEqual(referral.status, "pending_payment")

    def test_payment_validation_and_activity_can_reward_referrer(self):
        settings_obj = SubscriptionSystemSettings.get_solo()
        settings_obj.reward_referral_threshold = 1
        settings_obj.reward_min_activity_count = 2
        settings_obj.reward_bonus_days = 90
        settings_obj.save(
            update_fields=[
                "reward_referral_threshold",
                "reward_min_activity_count",
                "reward_bonus_days",
                "updated_at",
            ]
        )
        referrer = Pharmacy.objects.create(
            name="Pharmacie Reward",
            city="Bujumbura",
            address="Kinindo",
            phone_number="+25761000888",
            email="reward@example.com",
            is_verified=False,
        )
        PharmacySubscription.objects.create(
            pharmacy=referrer,
            subscription_status="expired",
            is_trial_active=False,
            trial_end_date=timezone.now() - timedelta(days=1),
        )
        safe_register_referral_from_code(referral_code=referrer.referral_code, referee=self.pharmacy)
        safe_mark_payment_validated_for_pharmacy(self.pharmacy, payment_reference="PAY-001")

        for index in range(2):
            prescription = Prescription.objects.create(
                patient_name=f"Patient Reward {index}",
                patient_email=f"reward-{index}@example.com",
                patient_user=User.objects.create_user(username=f"reward-patient-{index}", password="secret123"),
                pharmacy=self.pharmacy,
                status="completed",
            )
            safe_record_activity_for_referral(self.pharmacy, prescription, source_label="test_reward")

        referral = PharmacyReferral.objects.get(referee=self.pharmacy)
        referrer.refresh_from_db()
        referrer_subscription = PharmacySubscription.objects.get(pharmacy=referrer)

        self.assertEqual(referral.status, "rewarded")
        self.assertTrue(referrer.is_verified)
        self.assertEqual(referrer_subscription.subscription_status, "active")
        self.assertIsNotNone(referrer_subscription.next_payment_due_date)
        self.assertGreaterEqual((referrer_subscription.next_payment_due_date - timezone.now()).days, 89)

    def test_repeated_device_activity_creates_fraud_alert_and_blocks_referral(self):
        settings_obj = SubscriptionSystemSettings.get_solo()
        settings_obj.reward_device_daily_limit = 3
        settings_obj.save(update_fields=["reward_device_daily_limit", "updated_at"])
        referrer = Pharmacy.objects.create(
            name="Pharmacie Detecteur",
            city="Bujumbura",
            address="Ngagara",
            phone_number="+25761000777",
            email="detecteur@example.com",
        )
        safe_register_referral_from_code(referral_code=referrer.referral_code, referee=self.pharmacy)
        referral = PharmacyReferral.objects.get(referee=self.pharmacy)
        first_day = timezone.localdate() - timedelta(days=1)
        second_day = timezone.localdate()
        for day in [first_day, second_day]:
            for offset in range(4):
                PharmacyReferralDeviceLog.objects.create(
                    referral=referral,
                    pharmacy=self.pharmacy,
                    prescription_id=100 + (offset if day == first_day else offset + 10),
                    device_fingerprint="same-device",
                    activity_date=day,
                    source_label="manual-test",
                )

        _evaluate_fraud(referral, "same-device")
        referral.refresh_from_db()

        self.assertEqual(referral.status, "fraud_blocked")
        self.assertTrue(PharmacyReferralFraudAlert.objects.filter(referral=referral).exists())

    def test_reward_payload_generates_missing_referral_code_for_existing_pharmacy(self):
        Pharmacy.objects.filter(pk=self.pharmacy.pk).update(referral_code="")
        self.pharmacy.refresh_from_db()

        payload = build_pharmacy_reward_payload(self.pharmacy)

        self.pharmacy.refresh_from_db()
        self.assertTrue(self.pharmacy.referral_code)
        self.assertEqual(payload["referral_code"], self.pharmacy.referral_code)
        self.assertTrue(payload["referral_link"].endswith(f"/register?ref={self.pharmacy.referral_code}"))
