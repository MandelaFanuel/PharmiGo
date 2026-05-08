from unittest.mock import patch
from datetime import timedelta

from django.contrib.auth.models import User
from django.test import TestCase
from django.utils import timezone

from apps.pharmigo_chatbot.models import ConversationHistory, ConversationSession
from apps.pharmigo_chatbot.services import ChatbotContextService, ChatbotResponseService
from apps.pharmacies.models import Pharmacy as RealPharmacy, PharmacySubscription
from apps.prescriptions.models import PharmacyStock as RealPharmacyStock, Prescription, PrescriptionResponse, MedicationExtraction
from apps.users.models import UserProfile


class ChatbotResponseServiceTests(TestCase):
    def setUp(self):
        self.user = User.objects.create_user(
            username="patient-chatbot",
            email="patient-chatbot@example.com",
            password="testpass123",
        )
        UserProfile.objects.create(user=self.user, role="patient", email_verified=True)
        self.pharmacy = RealPharmacy.objects.create(
            name="Pharmacie Mapendo",
            city="Bujumbura",
            address="Rohero I",
            phone_number="+25761010000",
            is_verified=True,
        )
        self.pharmacy_user = User.objects.create_user(
            username="pharmacy-chatbot",
            email="pharmacy-chatbot@example.com",
            password="testpass123",
            first_name="Mapendo",
        )
        UserProfile.objects.create(
            user=self.pharmacy_user,
            role="pharmacy",
            email_verified=True,
            pharmacy=self.pharmacy,
        )
        PharmacySubscription.objects.create(
            pharmacy=self.pharmacy,
            subscription_status="active",
            is_trial_active=False,
            trial_end_date=timezone.now() + timedelta(days=7),
            next_payment_due_date=timezone.now() + timedelta(days=22),
        )
        self.admin_user = User.objects.create_user(
            username="admin-chatbot",
            email="admin-chatbot@example.com",
            password="testpass123",
        )
        UserProfile.objects.create(user=self.admin_user, role="admin", email_verified=True)

    @patch("apps.pharmigo_chatbot.services.GeminiChatService.generate_response")
    def test_uses_gemini_humanized_reply_for_general_question(self, mocked_generate):
        mocked_generate.return_value = "Bonjour, je suis PharmiGo et je peux vous accompagner."

        response = ChatbotResponseService().answer("Bonjour PharmiGo", self.user)

        self.assertEqual(response, "Bonjour, je suis PharmiGo et je peux vous accompagner.")
        mocked_generate.assert_called_once()

    def test_falls_back_to_internal_answer_when_gemini_unavailable(self):
        service = ChatbotResponseService()
        service.gemini_chat.available = False

        response = service.answer("Comment utiliser PharmiGo ?", self.user)

        self.assertTrue(response)
        self.assertIsInstance(response, str)
        self.assertGreater(len(response), 20)
        self.assertNotIn("verification d'email", response.lower())
        self.assertNotIn("vérification d'email", response.lower())
        self.assertNotIn("analyser une ordonnance", response.lower())

    @patch("apps.pharmigo_chatbot.services.GeminiChatService.generate_response")
    def test_greeting_does_not_trigger_medication_lookup(self, mocked_generate):
        mocked_generate.return_value = "Bonjour, je suis PharmiGo et je peux vous accompagner."
        service = ChatbotResponseService()

        with patch.object(service, "_answer_medicine_lookup", wraps=service._answer_medicine_lookup) as mocked_lookup:
            response = service.answer("Bonjour PharmiGo, peux-tu me dire ce que tu fais ?", self.user)

        self.assertEqual(response, "Bonjour, je suis PharmiGo et je peux vous accompagner.")
        mocked_lookup.assert_not_called()

    @patch("apps.pharmigo_chatbot.services.GeminiChatService.generate_response")
    def test_gemini_receives_recent_history_buffer(self, mocked_generate):
        mocked_generate.return_value = "Je me souviens du contexte et je vous réponds naturellement."
        session = ConversationSession.objects.create(user=self.user, session_key="user-1-default")
        for index in range(10):
            ConversationHistory.objects.create(session=session, user=self.user, sender="user", message=f"message patient {index}")
            ConversationHistory.objects.create(session=session, user=self.user, sender="bot", message=f"message bot {index}")

        service = ChatbotResponseService()
        response = service.answer("Je reviens, on reprend ?", self.user)

        self.assertEqual(response, "Je me souviens du contexte et je vous réponds naturellement.")
        kwargs = mocked_generate.call_args.kwargs
        recent_history = kwargs["structured_context"]["recent_chat_history"]
        self.assertGreaterEqual(len(recent_history), 10)
        self.assertLessEqual(len(recent_history), 15)
        self.assertTrue(any("message patient 9" in row["message"] for row in recent_history))

    @patch("apps.pharmigo_chatbot.services.GeminiChatService.generate_response")
    def test_guest_session_history_is_sent_to_gemini(self, mocked_generate):
        mocked_generate.return_value = "Je me souviens aussi des échanges invités."
        session = ConversationSession.objects.create(user=None, session_key="guest-demo")
        ConversationHistory.objects.create(session=session, user=None, sender="user", message="salut")
        ConversationHistory.objects.create(session=session, user=None, sender="bot", message="bonjour, comment puis-je vous aider ?")
        ConversationHistory.objects.create(session=session, user=None, sender="user", message="je suis stressé")

        response = ChatbotResponseService().answer("je reviens pour continuer", None, session=session)

        self.assertEqual(response, "Je me souviens aussi des échanges invités.")
        recent_history = mocked_generate.call_args.kwargs["structured_context"]["recent_chat_history"]
        self.assertEqual(len(recent_history), 3)
        self.assertEqual(recent_history[0]["message"], "salut")

    def test_context_builds_structured_memory_across_visits(self):
        session = ConversationSession.objects.create(user=self.user, session_key="user-1-default")
        ConversationHistory.objects.create(session=session, user=self.user, sender="user", message="Je cherche du paracetamol")
        ConversationHistory.objects.create(session=session, user=self.user, sender="bot", message="Je peux verifier les pharmacies.")
        ConversationHistory.objects.create(session=session, user=self.user, sender="user", message="J'ai aussi de la fievre depuis hier")

        context = ChatbotContextService().build_context(self.user)
        memory = context["conversation_memory"]

        self.assertGreaterEqual(memory["visit_count"], 1)
        self.assertTrue(memory["recurring_topics"])
        self.assertIn(memory["preferred_tone"], {"reassuring", "guided", "direct", "standard"})

    def test_health_question_returns_prudent_guidance_without_gemini(self):
        service = ChatbotResponseService()
        service.gemini_chat.available = False

        response = service.answer("J'ai de la fievre et des vomissements, est-ce grave ?", self.user)

        self.assertIn("orientation generale prudente", response)
        self.assertIn("Signaux d'alerte", response)

    def test_colloquial_distress_message_does_not_trigger_medication_lookup(self):
        service = ChatbotResponseService()
        service.gemini_chat.available = False

        with patch.object(service, "_answer_medicine_lookup", wraps=service._answer_medicine_lookup) as mocked_lookup:
            response = service.answer("je suis souffran mon frere", self.user)

        mocked_lookup.assert_not_called()
        self.assertIn("orientation generale prudente", response)
        self.assertNotIn("stocks des pharmacies", response.lower())

    def test_admin_role_uses_admin_fallback(self):
        service = ChatbotResponseService()
        service.gemini_chat.available = False

        response = service.answer("Que peux-tu faire pour moi ?", self.admin_user)

        self.assertIn("plateforme", response.lower())
        self.assertIn("pharmigo", response.lower())

    def test_farewell_does_not_trigger_medication_lookup(self):
        service = ChatbotResponseService()
        service.gemini_chat.available = False

        with patch.object(service, "_answer_medicine_lookup", wraps=service._answer_medicine_lookup) as mocked_lookup:
            response = service.answer("au revoir mon frère", self.user)

        mocked_lookup.assert_not_called()
        self.assertNotIn("stocks des pharmacies", response.lower())
        self.assertTrue(any(term in response.lower() for term in ["prenez soin", "revenez", "reviens", "wiyubare"]))

    def test_privacy_request_invites_guest_to_login(self):
        guest_user = type("GuestUser", (), {"is_authenticated": False})()
        service = ChatbotResponseService()
        service.gemini_chat.available = False

        response = service.answer("si je veux parler de quelque chose de plus confidentiel, que dois-je faire ?", guest_user)

        self.assertIn("connect", response.lower())
        self.assertNotIn("stocks des pharmacies", response.lower())

    def test_authenticated_privacy_request_is_more_precise(self):
        service = ChatbotResponseService()
        service.gemini_chat.available = False

        response = service.answer("je veux te parler de quelque chose de prive", self.user)

        self.assertIn("espace connecte", response.lower())
        self.assertNotIn("stocks des pharmacies", response.lower())

    def test_connection_intent_does_not_trigger_medication_lookup(self):
        service = ChatbotResponseService()
        service.gemini_chat.available = False

        with patch.object(service, "_answer_medicine_lookup", wraps=service._answer_medicine_lookup) as mocked_lookup:
            response = service.answer("Je vais me connecter pour en discuter plus sur ma situation", self.user)

        mocked_lookup.assert_not_called()
        self.assertIn("espace connecte", response.lower())
        self.assertNotIn("stocks des pharmacies", response.lower())

    @patch("apps.pharmigo_chatbot.services.GeminiChatService.generate_response")
    def test_connection_phrase_is_sent_to_gemini_as_connection_intent_not_stock_lookup(self, mocked_generate):
        mocked_generate.return_value = "Oui, vous pouvez vous connecter pour que nous parlions plus personnellement."
        service = ChatbotResponseService()

        with patch.object(service, "_answer_medicine_lookup", wraps=service._answer_medicine_lookup) as mocked_lookup:
            response = service.answer("Je vais me connecter pour en discuter plus sur ma situation", self.user)

        self.assertEqual(response, "Oui, vous pouvez vous connecter pour que nous parlions plus personnellement.")
        mocked_lookup.assert_not_called()
        self.assertEqual(mocked_generate.call_args.kwargs["response_kind"], "connection_intent")

    @patch("apps.pharmigo_chatbot.services.GeminiChatService.generate_response")
    def test_meta_sentence_does_not_trigger_stock_lookup(self, mocked_generate):
        mocked_generate.return_value = "D'accord cher frère, je vous écoute d'abord. Dites-moi ce qui vous préoccupe."
        service = ChatbotResponseService()

        with patch.object(service, "_answer_medicine_lookup", wraps=service._answer_medicine_lookup) as mocked_lookup:
            response = service.answer(
                "je veux que tu me reponde d'abord cher frere, je sais ce que tu fais mais j'ai un sujet pertinent auquel j'ai besoin que tu me conseil",
                self.user,
            )

        self.assertEqual(response, "D'accord cher frère, je vous écoute d'abord. Dites-moi ce qui vous préoccupe.")
        mocked_lookup.assert_not_called()
        self.assertEqual(mocked_generate.call_args.kwargs["response_kind"], "general_conversation")

    def test_affection_message_stays_conversational(self):
        service = ChatbotResponseService()
        service.gemini_chat.available = False

        with patch.object(service, "_answer_medicine_lookup", wraps=service._answer_medicine_lookup) as mocked_lookup:
            response = service.answer("Je t'aime bien PharmiGo", self.user)

        mocked_lookup.assert_not_called()
        self.assertIn("merci", response.lower())
        self.assertNotIn("stocks", response.lower())

    def test_safe_fallback_answer_remains_human_for_greeting(self):
        service = ChatbotResponseService()

        response = service.safe_fallback_answer("Salut PharmiGo", self.user)

        self.assertTrue(any(term in response.lower() for term in ["salut", "bonjour", "pharmigo"]))
        self.assertNotIn("probleme technique", response.lower())

    def test_safe_fallback_for_greeting_does_not_repeat_capabilities(self):
        service = ChatbotResponseService()

        response = service.safe_fallback_answer("bonjour cher PharmiGo", self.user)

        self.assertNotIn("analyser une ordonnance", response.lower())
        self.assertNotIn("chercher un medicament", response.lower())

    def test_medicine_lookup_only_surfaces_certified_or_trial_partners(self):
        verified_partner = RealPharmacy.objects.create(
            name="Pharmacie Certifiee",
            city="Bujumbura",
            address="Rohero",
            phone_number="+25761000001",
            is_verified=True,
        )
        PharmacySubscription.objects.create(
            pharmacy=verified_partner,
            subscription_status="active",
            is_trial_active=False,
            trial_end_date=timezone.now(),
        )
        RealPharmacyStock.objects.create(
            pharmacy=verified_partner,
            medication_name="Paracetamol",
            dosage="500mg",
            quantity=12,
            unit="comprimés",
            is_available=True,
        )

        hidden_partner = RealPharmacy.objects.create(
            name="Pharmacie Cachee",
            city="Bujumbura",
            address="Kinindo",
            phone_number="+25761000002",
            is_verified=False,
        )
        PharmacySubscription.objects.create(
            pharmacy=hidden_partner,
            subscription_status="active",
            is_trial_active=False,
            trial_end_date=timezone.now(),
        )
        RealPharmacyStock.objects.create(
            pharmacy=hidden_partner,
            medication_name="Paracetamol",
            dosage="500mg",
            quantity=30,
            unit="comprimés",
            is_available=True,
        )

        service = ChatbotResponseService()
        answer, confidence = service._answer_medicine_lookup(["paracetamol"], "patient", self.user)

        self.assertIn("Pharmacie Certifiee", answer)
        self.assertIn("Partenaire Certifie PharmiGo", answer)
        self.assertNotIn("Pharmacie Cachee", answer)
        self.assertGreater(confidence, 0.85)

    def test_trial_partner_is_visible_in_stock_lookup(self):
        trial_partner = RealPharmacy.objects.create(
            name="Pharmacie Trial",
            city="Bujumbura",
            address="Bwiza",
            phone_number="+25761000003",
            is_verified=False,
        )
        PharmacySubscription.objects.create(
            pharmacy=trial_partner,
            subscription_status="trial",
            is_trial_active=True,
            trial_end_date=timezone.now() + timedelta(days=5),
        )
        RealPharmacyStock.objects.create(
            pharmacy=trial_partner,
            medication_name="Ibuprofene",
            dosage="400mg",
            quantity=8,
            unit="comprimés",
            is_available=True,
        )

        service = ChatbotResponseService()
        answer, _confidence = service._answer_medicine_lookup(["ibuprofene"], "patient", self.user)

        self.assertIn("Pharmacie Trial", answer)
        self.assertIn("Partenaire Certifie PharmiGo", answer)

    def test_when_no_eligible_partner_exists_response_mentions_certified_partner_unavailable(self):
        expired_partner = RealPharmacy.objects.create(
            name="Pharmacie Expiree",
            city="Bujumbura",
            address="Kamenge",
            phone_number="+25761000004",
            is_verified=True,
        )
        PharmacySubscription.objects.create(
            pharmacy=expired_partner,
            subscription_status="expired",
            is_trial_active=False,
            trial_end_date=timezone.now() - timedelta(days=1),
        )
        RealPharmacyStock.objects.create(
            pharmacy=expired_partner,
            medication_name="Amoxicilline",
            dosage="500mg",
            quantity=15,
            unit="gélules",
            is_available=True,
        )

        service = ChatbotResponseService()
        answer, confidence = service._answer_medicine_lookup(["amoxicilline"], "patient", self.user)

        self.assertIn("partenaire certifie", answer.lower())
        self.assertNotIn("Pharmacie Expiree", answer)
        self.assertGreaterEqual(confidence, 0.75)

    def test_pharmacy_weekly_report_uses_real_system_metrics(self):
        now = timezone.now()
        RealPharmacyStock.objects.create(
            pharmacy=self.pharmacy,
            medication_name="Paracetamol",
            dosage="500mg",
            quantity=12,
            unit="comprimés",
            is_available=True,
        )
        RealPharmacyStock.objects.create(
            pharmacy=self.pharmacy,
            medication_name="Amoxicilline",
            dosage="500mg",
            quantity=3,
            unit="gélules",
            is_available=True,
        )
        prescription = Prescription.objects.create(
            patient_name="Aline",
            patient_email="aline@example.com",
            patient_user=self.user,
            pharmacy=self.pharmacy,
            status="completed",
            medication_name="Paracetamol",
            total_amount=2500,
        )
        Prescription.objects.filter(id=prescription.id).update(created_at=now - timedelta(days=2))
        MedicationExtraction.objects.create(
            prescription=prescription,
            name="Paracetamol",
            dosage="500mg",
            quantity=2,
            confirmed=True,
        )
        PrescriptionResponse.objects.create(
            prescription=prescription,
            pharmacy=self.pharmacy,
            responder_name="Mapendo",
            availability_note="Disponible",
            estimated_minutes=20,
            total_price=2500,
            status="confirmed",
        )

        service = ChatbotResponseService()
        service.gemini_chat.available = False

        response = service.answer("fais moi mon rapport hebdomadaire en pdf", self.pharmacy_user)

        self.assertIn("rapport d'activité professionnel", response.lower())
        self.assertIn("pharmacie mapendo", response.lower())
        self.assertIn("ordonnances directement traitées", response.lower())
        self.assertIn("nouveaux contacts patients", response.lower())
        self.assertIn("volume de messagerie traité", response.lower())
        self.assertIn("prêt", response.lower())
        self.assertNotIn("copier les totaux", response.lower())
        self.assertNotIn("transmettez ici", response.lower())

    def test_admin_report_uses_aggregated_metrics_without_message_content(self):
        service = ChatbotResponseService()
        service.gemini_chat.available = False

        response = service.answer("prépare moi un rapport mensuel du réseau en pdf", self.admin_user)

        self.assertIn("rapport de supervision pharmigo", response.lower())
        self.assertIn("pharmacies partenaires vérifiées actives", response.lower())
        self.assertIn("aucun contenu textuel des conversations", response.lower())
