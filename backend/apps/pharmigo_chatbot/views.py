import json
import logging

from django.core.serializers.json import DjangoJSONEncoder
from django.db import transaction
from django.utils import timezone
from rest_framework import status, viewsets
from rest_framework.decorators import action, api_view, permission_classes
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from .models import (
    Pharmacy,
    Medicine,
    MedicineSynonym,
    PharmacyStock,
    Prescription,
    PrescriptionItem,
    PrescriptionHistory,
    ChatMessage,
    ChatbotKnowledgeBase,
    ChatbotLearningData,
    ConversationSession,
    ConversationHistory,
)

from .serializers import (
    PharmacySerializer,
    MedicineSerializer,
    MedicineSynonymSerializer,
    PharmacyStockSerializer,
    PrescriptionSerializer,
    ChatbotKnowledgeBaseSerializer,
    ChatbotLearningDataSerializer,
    ConversationHistorySerializer,
)

from .services import (
    PrescriptionAIService,
    PharmacyMatchingService,
    MedicineDatabase,
    ChatbotContextService,
    ChatbotResponseService,
)
from .utils import normalize_text


logger = logging.getLogger(__name__)


def _get_authenticated_user(request):
    user = getattr(request, "user", None)
    return user if getattr(user, "is_authenticated", False) else None


def _resolve_real_prescription(user, prescription_id):
    if not prescription_id:
        return None

    from apps.prescriptions.models import Prescription as RealPrescription

    queryset = RealPrescription.objects.filter(pk=prescription_id)
    if user is not None and getattr(getattr(user, "profile", None), "role", None) == "patient":
        queryset = queryset.filter(patient_user=user)
    return queryset.first()


def _make_json_safe(value):
    return json.loads(json.dumps(value, cls=DjangoJSONEncoder))


def _get_or_create_conversation_session(request, user, prescription=None):
    profile = getattr(user, "profile", None) if user is not None else None
    pharmacy = getattr(profile, "pharmacy", None) if profile is not None else None

    if user is not None:
        session_key = f"user-{user.id}"
        if prescription is not None:
            session_key = f"{session_key}-prescription-{prescription.id}"
        else:
            session_key = f"{session_key}-default"
    else:
        if not request.session.session_key:
            request.session.save()
        session_key = f"guest-{request.session.session_key}"

    context_snapshot = _make_json_safe(ChatbotContextService().build_context(user))
    session, created = ConversationSession.objects.get_or_create(
        user=user,
        session_key=session_key,
        defaults={
            "pharmacy": pharmacy,
            "prescription": prescription,
            "context_snapshot": context_snapshot,
        },
    )

    fields_to_update = []
    if session.pharmacy_id != getattr(pharmacy, "id", None):
        session.pharmacy = pharmacy
        fields_to_update.append("pharmacy")
    if session.prescription_id != getattr(prescription, "id", None):
        session.prescription = prescription
        fields_to_update.append("prescription")
    session.context_snapshot = context_snapshot
    fields_to_update.extend(["context_snapshot", "updated_at"])
    if created:
        session.save()
    else:
        session.save(update_fields=fields_to_update)
    return session


def _refresh_session_snapshot(session, user):
    if session is None or user is None:
        return

    refreshed_context = _make_json_safe(ChatbotContextService().build_context(user))
    session.context_snapshot = refreshed_context
    session.save(update_fields=["context_snapshot", "updated_at"])


def _store_chat_exchange(user, session, question, answer, prescription=None):
    if user is not None:
        ChatMessage.objects.create(
            user=user,
            prescription_id=prescription.id if prescription is not None else None,
            sender=ChatMessage.Sender.USER,
            message=question,
        )
        ChatMessage.objects.create(
            user=user,
            prescription_id=prescription.id if prescription is not None else None,
            sender=ChatMessage.Sender.BOT,
            message=answer,
        )

    if session is None:
        return

    ConversationHistory.objects.bulk_create(
        [
            ConversationHistory(
                session=session,
                user=user,
                prescription=prescription,
                sender="user",
                message=question,
            ),
            ConversationHistory(
                session=session,
                user=user,
                prescription=prescription,
                sender="bot",
                message=answer,
                metadata={"context_role": session.context_snapshot.get("role", "guest")},
            ),
        ]
    )
    _refresh_session_snapshot(session, user)


class PharmacyViewSet(viewsets.ModelViewSet):
    queryset = Pharmacy.objects.all()
    serializer_class = PharmacySerializer
    permission_classes = [IsAuthenticated]


class MedicineViewSet(viewsets.ModelViewSet):
    queryset = Medicine.objects.all()
    serializer_class = MedicineSerializer
    permission_classes = [IsAuthenticated]


class PharmacyStockViewSet(viewsets.ModelViewSet):
    queryset = PharmacyStock.objects.all()
    serializer_class = PharmacyStockSerializer
    permission_classes = [IsAuthenticated]


class ChatbotKnowledgeBaseView(APIView):
    permission_classes = [AllowAny]

    def get(self, request):
        role = request.query_params.get("role_target")
        queryset = ChatbotKnowledgeBase.objects.filter(is_active=True)
        if role in {"patient", "pharmacy", "all"}:
            queryset = queryset.filter(role_target__in=[role, "all"] if role != "all" else ["all"])
        serializer = ChatbotKnowledgeBaseSerializer(queryset.order_by("category", "question"), many=True)
        return Response(serializer.data)

    def post(self, request):
        if not getattr(request.user, "is_staff", False):
            return Response({"error": "Action réservée aux administrateurs."}, status=status.HTTP_403_FORBIDDEN)
        serializer = ChatbotKnowledgeBaseSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        serializer.save()
        return Response(serializer.data, status=status.HTTP_201_CREATED)


class ChatbotContextView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        context = ChatbotContextService().build_context(request.user)
        return Response(context)


class ChatbotLearnView(APIView):
    permission_classes = [AllowAny]

    def post(self, request):
        payload = request.data.copy()
        if getattr(request.user, "is_authenticated", False):
            payload["user"] = request.user.id
            if not payload.get("source"):
                payload["source"] = getattr(getattr(request.user, "profile", None), "role", "system")
        serializer = ChatbotLearningDataSerializer(data=payload)
        serializer.is_valid(raise_exception=True)
        serializer.save()
        return Response(serializer.data, status=status.HTTP_201_CREATED)


class ChatbotMessageView(APIView):
    permission_classes = [AllowAny]

    def post(self, request):
        question = str(request.data.get("message") or request.data.get("question") or "").strip()
        preferred_language = str(request.data.get("language") or "").strip().lower()
        if not question:
            return Response({"error": "Message requis."}, status=status.HTTP_400_BAD_REQUEST)
        user = _get_authenticated_user(request)
        try:
            prescription = _resolve_real_prescription(user, request.data.get("prescription_id"))
            session = _get_or_create_conversation_session(request, user, prescription)
            answer = ChatbotResponseService().answer(
                question,
                user,
                session=session,
                preferred_language=preferred_language,
            )
            _store_chat_exchange(user, session, question, answer, prescription)
            return Response(
                {
                    "message": answer,
                    "answer": answer,
                    "question": question,
                    "session_key": getattr(session, "session_key", None),
                },
                status=status.HTTP_200_OK,
            )
        except Exception:
            logger.exception("ChatbotMessageView failed")
            fallback = ChatbotResponseService().safe_fallback_answer(
                question,
                user,
                preferred_language=preferred_language,
            )
            return Response({"message": fallback, "answer": fallback, "question": question}, status=status.HTTP_200_OK)


class PrescriptionViewSet(viewsets.ModelViewSet):
    queryset = Prescription.objects.all()
    serializer_class = PrescriptionSerializer
    permission_classes = [IsAuthenticated]

    def perform_create(self, serializer):
        prescription = serializer.save(patient=self.request.user)

        PrescriptionHistory.objects.create(
            prescription=prescription,
            actor=self.request.user,
            action="prescription_published",
            note="Le patient a publié une ordonnance."
        )

    @action(detail=True, methods=["post"])
    def analyze(self, request, pk=None):
        prescription = self.get_object()

        if prescription.patient != request.user:
            return Response({"error": "Action non autorisée."}, status=403)

        fallback_text = request.data.get("text", "")

        result = PrescriptionAIService().analyze(
            prescription.image.path,
            fallback_text=fallback_text
        )

        with transaction.atomic():
            prescription.extracted_text = result["raw_text"]
            prescription.confidence_score = result["confidence_score"]
            prescription.status = (
                Prescription.Status.NEEDS_CONFIRMATION
                if result["needs_confirmation"]
                else Prescription.Status.ANALYZED
            )
            prescription.save()

            prescription.items.all().delete()

            for item in result["medicines"]:
                PrescriptionItem.objects.create(
                    prescription=prescription,
                    medicine_name=item["medicine_name"],
                    normalized_name=item["normalized_name"],
                    dosage=item["dosage"],
                    form=item["form"],
                    quantity=item["quantity"],
                    posology=item["posology"],
                    confidence=item["confidence"],
                )

            PrescriptionHistory.objects.create(
                prescription=prescription,
                actor=request.user,
                action="prescription_analyzed",
                note="Le chatbot a analysé l’ordonnance.",
                metadata={
                    "confidence_score": result["confidence_score"],
                    "needs_confirmation": result["needs_confirmation"],
                }
            )

        if result["needs_confirmation"]:
            message = "J’ai analysé l’ordonnance, mais certains médicaments doivent être confirmés."
        else:
            message = "Ordonnance analysée avec succès."

        return Response({
            "message": message,
            "needs_confirmation": result["needs_confirmation"],
            "prescription": PrescriptionSerializer(prescription).data,
        })

    @action(detail=True, methods=["post"])
    def confirm_items(self, request, pk=None):
        prescription = self.get_object()

        if prescription.patient != request.user:
            return Response({"error": "Action non autorisée."}, status=403)

        items = request.data.get("items", [])

        with transaction.atomic():
            prescription.items.all().delete()

            for item in items:
                name = item.get("medicine_name", "").strip()

                if not name:
                    continue

                PrescriptionItem.objects.create(
                    prescription=prescription,
                    medicine_name=name,
                    normalized_name=normalize_text(name),
                    dosage=item.get("dosage", ""),
                    form=item.get("form", ""),
                    quantity=item.get("quantity", ""),
                    posology=item.get("posology", ""),
                    confidence=1.0,
                    confirmed_by_patient=True,
                )

            prescription.status = Prescription.Status.ANALYZED
            prescription.save()

            PrescriptionHistory.objects.create(
                prescription=prescription,
                actor=request.user,
                action="items_confirmed_by_patient",
                note="Le patient a confirmé les médicaments détectés."
            )

        return Response({
            "message": "Médicaments confirmés. Recherche des pharmacies possible.",
            "prescription": PrescriptionSerializer(prescription).data,
        })

    @action(detail=True, methods=["get"])
    def match_pharmacies(self, request, pk=None):
        prescription = self.get_object()

        if prescription.patient != request.user:
            return Response({"error": "Action non autorisée."}, status=403)

        if prescription.status != Prescription.Status.ANALYZED:
            return Response({"error": "L’ordonnance doit d’abord être confirmée ou analysée."}, status=400)

        results = PharmacyMatchingService().match(prescription)

        return Response({
            "message": "Résultat de recherche des pharmacies.",
            "results": results,
        })

    @action(detail=True, methods=["post"])
    def select_pharmacy(self, request, pk=None):
        prescription = self.get_object()

        if prescription.patient != request.user:
            return Response({"error": "Action non autorisée."}, status=403)

        pharmacy_id = request.data.get("pharmacy_id")

        try:
            pharmacy = Pharmacy.objects.get(id=pharmacy_id, is_active=True)
        except Pharmacy.DoesNotExist:
            return Response({"error": "Pharmacie introuvable."}, status=404)

        prescription.selected_pharmacy = pharmacy
        prescription.status = Prescription.Status.PHARMACY_SELECTED
        prescription.selected_at = timezone.now()
        prescription.save()

        PrescriptionHistory.objects.create(
            prescription=prescription,
            actor=request.user,
            pharmacy=pharmacy,
            action="pharmacy_selected",
            note="Le patient a choisi une pharmacie."
        )

        return Response({"message": "Pharmacie sélectionnée avec succès."})

    @action(detail=True, methods=["post"])
    def pharmacy_mark_served(self, request, pk=None):
        prescription = self.get_object()
        pharmacy = getattr(request.user, "pharmacy_profile", None)

        if not pharmacy:
            return Response({"error": "Seule une pharmacie peut faire cette action."}, status=403)

        if prescription.selected_pharmacy != pharmacy:
            return Response({"error": "Cette ordonnance n’est pas destinée à votre pharmacie."}, status=403)

        if prescription.status != Prescription.Status.PHARMACY_SELECTED:
            return Response({"error": "Statut invalide."}, status=400)

        prescription.status = Prescription.Status.WAITING_PATIENT_CONFIRMATION
        prescription.pharmacy_confirmed_at = timezone.now()
        prescription.save()

        PrescriptionHistory.objects.create(
            prescription=prescription,
            actor=request.user,
            pharmacy=pharmacy,
            action="pharmacy_marked_served",
            note="La pharmacie déclare avoir servi l’ordonnance."
        )

        return Response({
            "message": "Ordonnance déclarée servie. En attente de confirmation du patient."
        })

    @action(detail=True, methods=["post"])
    def patient_confirm_served(self, request, pk=None):
        prescription = self.get_object()

        if prescription.patient != request.user:
            return Response({"error": "Action non autorisée."}, status=403)

        if prescription.status != Prescription.Status.WAITING_PATIENT_CONFIRMATION:
            return Response({"error": "Cette ordonnance n’attend pas votre confirmation."}, status=400)

        prescription.status = Prescription.Status.SERVED
        prescription.patient_confirmed_at = timezone.now()
        prescription.served_at = timezone.now()
        prescription.save()

        PrescriptionHistory.objects.create(
            prescription=prescription,
            actor=request.user,
            pharmacy=prescription.selected_pharmacy,
            action="patient_confirmed_served",
            note="Le patient confirme avoir acheté ses médicaments."
        )

        return Response({
            "message": "Ordonnance classée comme déjà servie."
        })


@api_view(["GET"])
@permission_classes([AllowAny])
def chatbot_welcome(request):
    user = _get_authenticated_user(request)
    username = getattr(user, "username", "")

    if username:
        message = (
            f"Bienvenue {username} sur PharmiGo 👋 ! "
            f"Je suis ravi de vous accueillir parmi nous. "
            f"Publiez votre ordonnance, je vais l'analyser, demander confirmation si nécessaire, "
            f"puis chercher les pharmacies qui possèdent vos médicaments."
        )
    else:
        message = (
            f"Bienvenue sur PharmiGo 👋, {request.user.username} ! "
            f"Je suis ravi de vous accueillir parmi nous. "
            f"Publiez votre ordonnance, je vais l'analyser, demander confirmation si nécessaire, "
            f"puis chercher les pharmacies qui possèdent vos médicaments."
        )

    session = _get_or_create_conversation_session(request, user)
    if session is not None and not session.messages.exists():
        ConversationHistory.objects.create(
            session=session,
            user=user,
            sender="bot",
            message=message,
            metadata={"type": "welcome"},
        )
        ChatMessage.objects.create(
            user=user,
            sender=ChatMessage.Sender.BOT,
            message=message,
        )

    return Response({"message": message})


@api_view(["POST"])
@permission_classes([AllowAny])
def chatbot_message(request):
    """Chatbot conversationnel intelligent pour guider l'utilisateur"""
    user = _get_authenticated_user(request)
    user_message = str(request.data.get("message") or request.data.get("question") or "").strip()
    prescription_id = request.data.get("prescription_id")

    if not user_message:
        return Response({"error": "Message requis."}, status=status.HTTP_400_BAD_REQUEST)

    try:
        prescription = _resolve_real_prescription(user, prescription_id)
        bot_response = ChatbotResponseService().answer(user_message, user)
        session = _get_or_create_conversation_session(request, user, prescription)
        _store_chat_exchange(user, session, user_message, bot_response, prescription)

        return Response(
            {
                "message": bot_response,
                "answer": bot_response,
                "session_key": getattr(session, "session_key", None),
            }
        )
    except Exception:
        logger.exception("chatbot_message endpoint failed")
        fallback = ChatbotResponseService().safe_fallback_answer(user_message, user)
        return Response(
            {
                "message": fallback,
                "answer": fallback,
                "session_key": None,
            }
        )


def generate_chatbot_response(user_message: str, user, prescription_id: str = None) -> str:
    """Génère une réponse contextuelle du chatbot"""

    # Récupérer le prénom de l'utilisateur pour personnalisation
    username = user.username
    
    # Mots-clés pour la détection d'intention
    greetings = ["bonjour", "salut", "coucou", "hello", "hi", "bonsoir"]
    thanks = ["merci", "remerciement", "thanks", "remercie"]
    help_keywords = ["aide", "help", "comment", "aidez", "assister", "aider"]
    prescription_keywords = ["ordonnance", "prescription", "médicament", "pharmacie", "photo", "capture", "image"]
    status_keywords = ["statut", "état", "status", "où", "où en", "avancement", "progression"]
    goodbye_keywords = [
        "au revoir", "à bientôt", "a bientôt", "à plus", "a plus", "à plus tard", "a plus tard",
        "bonne journée", "bonne soirée", "bonne nuit", "ciao", "bye", "je pars", "je m'en vais",
        "je te laisse", "je vous laisse", "à la prochaine", "on se quitte", "je termine",
        "c'est tout", "rien d'autre", "je reviens", "je reviendrai", "je retourne",
        "je vais envoyer", "je vais上传", "je reviens avec", "je reviens pour",
        "je t'envoie", "je vous envoie", "à tout à l'heure", "à toute"
    ]
    platform_explanation_keywords = [
        "comment ça marche", "comment sa marche", "comment sa marche", "comment fonctionne",
        "comment marche", "c'est quoi", "c'est quoi pharmigo", "qu'est-ce que c'est",
        "explique", "explication", "présente", "présentation", "décris", "description",
        "à quoi sert", "a quoi sert", "à quoi sert pharmigo", "a quoi sert pharmigo",
        "pharmigo c'est", "pharmigo est", "plateforme", "application", "service",
        "fonctionne", "fonctionnalité", "comment utiliser", "comment ça fonctionne",
        "comment sa fonctionne", "comment on utilise", "comment on fait",
        "je veux savoir", "je voudrais savoir", "peux-tu m'expliquer", "peux tu m'expliquer",
        "tu peux m'expliquer", "tu peux expliquer", "explication de", "explique-moi",
        "explique moi", "parle-moi de", "parle moi de", "dis-moi", "dis moi",
        "raconte-moi", "raconte moi", "fais-moi", "fais moi"
    ]

    # Détection d'intention
    if any(word in user_message for word in greetings):
        greeting_text = f"Bienvenue {username} ! " if username else "Bonjour ! "
        return (
            f"{greeting_text}Je suis votre assistant PharmiGo 🤖. "
            "Je peux vous aider à analyser une ordonnance et trouver les pharmacies qui ont vos médicaments. "
            "Comment puis-je vous aider aujourd'hui ?"
        )

    if any(word in user_message for word in thanks):
        return "Avec plaisir ! N'hésitez pas si vous avez d'autres questions. 😊"

    if any(word in user_message for word in help_keywords):
        return (
            "Je peux vous aider avec :\n"
            "📸 **Analyser une ordonnance** - Prenez une photo de votre ordonnance\n"
            "💊 **Trouver des médicaments** - Je cherche dans les pharmacies partenaires\n"
            "📍 **Localiser une pharmacie** - Je vous guide vers la pharmacie la plus proche\n"
            "📋 **Suivre une commande** - Je vous tiens informé de l'avancement\n\n"
            "Que souhaitez-vous faire ?"
        )

    if prescription_id:
        try:
            prescription = Prescription.objects.get(id=prescription_id, patient=user)

            if any(word in user_message for word in status_keywords):
                status_labels = {
                    Prescription.Status.PUBLISHED: "📤 Publiée - En attente d'analyse",
                    Prescription.Status.NEEDS_CONFIRMATION: "⚠️ Confirmation nécessaire - Certains médicaments doivent être vérifiés",
                    Prescription.Status.ANALYZED: "✅ Analysée - Prête pour la recherche de pharmacies",
                    Prescription.Status.PHARMACY_SELECTED: "🏥 Pharmacie sélectionnée - En attente de préparation",
                    Prescription.Status.WAITING_PATIENT_CONFIRMATION: "⏳ En attente de votre confirmation",
                    Prescription.Status.SERVED: "✅ Déjà servie - Commande terminée",
                    Prescription.Status.CANCELLED: "❌ Annulée",
                }

                status_text = status_labels.get(prescription.status, "Statut inconnu")
                pharmacy_text = ""
                if prescription.selected_pharmacy:
                    pharmacy_text = f"\n🏥 Pharmacie choisie : {prescription.selected_pharmacy.name}"

                return f"📋 **Statut de votre ordonnance :**\n{status_text}{pharmacy_text}"

            if "analyser" in user_message or "analyse" in user_message:
                if prescription.status == Prescription.Status.PUBLISHED:
                    return (
                        "📸 Pour analyser votre ordonnance, cliquez sur le bouton 'Analyser' "
                        "ou envoyez-moi le texte de l'ordonnance si vous ne pouvez pas prendre de photo."
                    )
                elif prescription.status == Prescription.Status.NEEDS_CONFIRMATION:
                    items = prescription.items.all()
                    unconfirmed = [item for item in items if not item.confirmed_by_patient]
                    if unconfirmed:
                        return (
                            f"⚠️ J'ai détecté {len(unconfirmed)} médicament(s) qui nécessitent votre confirmation. "
                            "Veuillez vérifier les médicaments listés avant de continuer."
                        )
                elif prescription.status == Prescription.Status.ANALYZED:
                    return (
                        "✅ Votre ordonnance a été analysée avec succès ! "
                        "Je peux maintenant chercher les pharmacies qui ont vos médicaments. "
                        "Voulez-vous que je lance la recherche ?"
                    )

        except Prescription.DoesNotExist:
            pass

    # Détection de demande d'explication de la plateforme
    if any(keyword in user_message for keyword in platform_explanation_keywords):
        greeting = f"{first_name}, " if first_name else ""
        return (
            f"Avec plaisir {greeting}! Laissez-moi vous expliquer comment fonctionne PharmiGo 🚀\n\n"
            "**PharmiGo** est une plateforme innovante qui vous aide à trouver rapidement vos médicaments dans les pharmacies partenaires.\n\n"
            "📋 **Voici comment ça marche, étape par étape :**\n\n"
            "1️⃣ **Publiez votre ordonnance**\n"
            "   • Allez dans la section 'Ordonnances'\n"
            "   • Cliquez sur 'Publier une ordonnance'\n"
            "   • Prenez une photo claire de votre ordonnance médicale\n\n"
            "2️⃣ **Analyse intelligente**\n"
            "   • Mon système OCR analyse automatiquement votre ordonnance\n"
            "   • Je détecte les médicaments prescrits avec une grande précision\n"
            "   • Si nécessaire, je vous demande de confirmer certains médicaments\n\n"
            "3️⃣ **Recherche de pharmacies**\n"
            "   • Une fois l'ordonnance analysée, je recherche dans toutes les pharmacies partenaires\n"
            "   • Je vous montre celles qui ont vos médicaments en stock\n"
            "   • Vous voyez les prix et la disponibilité en temps réel\n\n"
            "4️⃣ **Choisissez votre pharmacie**\n"
            "   • Sélectionnez la pharmacie qui vous convient le mieux\n"
            "   • Elle prépare votre commande\n"
            "   • Vous recevez une notification quand c'est prêt\n\n"
            "5️⃣ **Récupérez vos médicaments**\n"
            "   • Rendez-vous à la pharmacie choisie\n"
            "   • Confirmez la réception de vos médicaments\n"
            "   • C'est terminé ! 🎉\n\n"
            "**💡 Les avantages de PharmiGo :**\n"
            "• Gain de temps - Plus besoin de visiter plusieurs pharmacies\n"
            "• Transparence - Vous savez où trouver vos médicaments\n"
            "• Suivi - Vous suivez votre commande en temps réel\n"
            "• Sécurité - Vos ordonnances sont analysées avec précision\n\n"
            "Je suis là pour vous accompagner à chaque étape ! N'hésitez pas à me poser des questions. 😊"
        )

    if any(word in user_message for word in prescription_keywords):
        return (
            "📋 **Pour publier une ordonnance :**\n"
            "1. Allez dans la section 'Ordonnances'\n"
            "2. Cliquez sur 'Publier une ordonnance'\n"
            "3. Prenez une photo claire de votre ordonnance\n"
            "4. Je l'analyserai automatiquement et vous guiderai étape par étape\n\n"
            "Je peux comprendre la plupart des écritures et je vous demanderai confirmation si nécessaire. 🤖"
        )

    # Réponse par défaut
    return (
        "Je suis là pour vous aider avec vos ordonnances et la recherche de médicaments. 🤖\n"
        "Je peux :\n"
        "• Analyser vos ordonnances automatiquement\n"
        "• Identifier les médicaments prescrits\n"
        "• Trouver les pharmacies qui les ont en stock\n"
        "• Vous guider jusqu'à l'achat\n\n"
        "Dites-moi comment je peux vous aider !"
    )


@api_view(["GET"])
@permission_classes([IsAuthenticated])
def get_chatbot_messages(request):
    """Récupérer les messages du chatbot"""
    messages = list(
        ConversationHistory.objects.filter(session__user=request.user)
        .select_related("session")
        .order_by("-created_at")[:200]
    )
    messages.reverse()
    serializer = ConversationHistorySerializer(messages, many=True)
    return Response(serializer.data)


@api_view(["POST"])
@permission_classes([IsAuthenticated])
def populate_medicine_database(request):
    """Endpoint pour peupler la base de données des médicaments (admin only)"""
    if not request.user.is_staff:
        return Response({"error": "Action réservée aux administrateurs."}, status=403)

    count = MedicineDatabase.populate_database()
    return Response({
        "message": f"Base de données peuplée avec {count} médicaments.",
        "medicine_count": count,
    })
