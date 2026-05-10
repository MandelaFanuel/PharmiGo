from asgiref.sync import async_to_sync
from channels.layers import get_channel_layer
from datetime import timedelta
from django.conf import settings
from django.db.models import Avg, CharField, Count, F, FloatField, Q, Value
from django.utils import timezone
from rest_framework import parsers, routers, status, viewsets
from rest_framework.decorators import action, api_view
from rest_framework.response import Response

from apps.chat.models import ChatMessage
from apps.chat.serializers import ChatMessageSerializer
from apps.notifications.models import Notification
from apps.notifications.serializers import NotificationSerializer
from apps.pharmacies.models import Pharmacy, PharmacyComment, PharmacyEngagement
from apps.pharmacies.payment_config import sanitize_payment_methods
from apps.pharmacies.serializers import PharmacyCommentSerializer, PharmacySerializer, SubscriptionSystemSettingsSerializer
from apps.pharmacies.services.access import PAYMENT_WALL_MESSAGE, get_active_partner_pharmacies, pharmacy_has_platform_access, sync_pharmacy_access_flags
from apps.pharmigo_chatbot.models import ChatbotLearningData, LearnedMedicalPattern, PharmiGoAIEventLog, PharmiGoAISettings
from apps.pharmigo_chatbot.services import AIConfigService, AIEventLogger, GeminiChatService
from apps.prescriptions.models import Prescription, PrescriptionComment, PrescriptionEngagement, PrescriptionResponse
from apps.prescriptions.serializers import PrescriptionCommentSerializer, PrescriptionResponseSerializer, PrescriptionSerializer
from apps.users.phone_numbers import normalize_phone_number
from apps.users.location import refresh_profile_location_from_request, sync_profile_coordinates
from apps.users.serializers import UserSerializer, email_already_used, phone_number_already_used
from django.contrib.auth import get_user_model
from apps.users.models import UserProfile
from apps.pharmacies.models import PharmacySubscription, SubscriptionPayment, SubscriptionSystemSettings
from apps.pharmacies.services.exchange_rate_service import ExchangeRateService
from apps.users.serializers import ensure_default_admin_user
from apps.pharmigo_chatbot.utils import normalize_text

User = get_user_model()


def get_request_user(request):
    authenticated_user = getattr(request, "user", None)
    if authenticated_user is not None and getattr(authenticated_user, "is_authenticated", False):
        try:
            return User.objects.select_related("profile", "profile__pharmacy").get(pk=authenticated_user.pk)
        except User.DoesNotExist:
            return authenticated_user
    return None


def build_presence_payload(profile):
    return {
        "user_id": profile.user_id,
        "role": profile.role,
        "is_online": profile.is_considered_online(),
        "last_seen": profile.last_seen.isoformat() if profile.last_seen else None,
        "pharmacy_id": profile.pharmacy_id,
    }


def broadcast_feed_event(event_type, payload):
    channel_layer = get_channel_layer()
    if channel_layer is None:
        return

    async_to_sync(channel_layer.group_send)(
        "chat_public-feed",
        {
            "type": "feed.event",
            "event_type": event_type,
            "payload": payload,
        },
    )


def create_targeted_notification(title, message, channel, recipient_user=None, recipient_pharmacy=None):
    return Notification.objects.create(
        title=title,
        message=message,
        channel=channel,
        recipient_user=recipient_user,
        recipient_pharmacy=recipient_pharmacy,
    )


def pharmacy_subscription_is_active(pharmacy):
    if pharmacy is None:
        return False
    ensure_subscription_for_pharmacy(pharmacy)
    return pharmacy_has_platform_access(pharmacy)


def filter_notifications_for_user(queryset, user):
    if user is None or not hasattr(user, "profile"):
        return queryset.none()

    allowed_channels = ["system"]
    if user.profile.role == "pharmacy":
        allowed_channels.extend(["messages:pharmacy", "prescriptions:pharmacy"])
    elif user.profile.role == "patient":
        allowed_channels.extend(["prescriptions:patient", "messages:patient"])

    target_filter = Q(recipient_user__isnull=True, recipient_pharmacy__isnull=True) | Q(recipient_user=user)
    if user.profile.role == "pharmacy" and user.profile.pharmacy_id:
        target_filter |= Q(recipient_pharmacy=user.profile.pharmacy)

    return queryset.filter(channel__in=allowed_channels).filter(target_filter).distinct()


def filter_chat_messages_for_user(queryset, user):
    if user is None or not hasattr(user, "profile"):
        return queryset.none()

    queryset = queryset.select_related("pharmacy", "sender_pharmacy", "recipient_user", "sender_user").exclude(
        sender_name="Equipe PharmiGo"
    ).exclude(
        sender_name__startswith="Pharmacie Test "
    ).exclude(
        sender_name__startswith="Pharmacie Image "
    ).exclude(
        sender_pharmacy__name__startswith="Pharmacie Test "
    ).exclude(
        sender_pharmacy__name__startswith="Pharmacie Image "
    ).exclude(
        pharmacy__name__startswith="Pharmacie Test "
    ).exclude(
        pharmacy__name__startswith="Pharmacie Image "
    )

    if user.profile.role == "pharmacy" and user.profile.pharmacy is not None:
        return queryset.filter(Q(sender_pharmacy=user.profile.pharmacy) | Q(pharmacy=user.profile.pharmacy)).order_by("created_at")

    if user.profile.role == "patient":
        return queryset.filter(Q(sender_user=user) | Q(recipient_user=user)).order_by("created_at")

    return queryset.none()


def pharmacy_can_message_patient(pharmacy, patient_user):
    patient_profile = getattr(patient_user, "profile", None)
    if pharmacy is None or patient_user is None or patient_profile is None or patient_profile.role != "patient":
        return False

    if ChatMessage.objects.filter(
        Q(sender_user=patient_user, pharmacy=pharmacy) | Q(sender_pharmacy=pharmacy, recipient_user=patient_user)
    ).exists():
        return True

    return Prescription.objects.filter(patient_user=patient_user).filter(
        Q(pharmacy=pharmacy) | Q(responses__pharmacy=pharmacy)
    ).exists()


def is_admin_user(user):
    return user is not None and getattr(user, "is_staff", False)


def ensure_subscription_for_pharmacy(pharmacy):
    if pharmacy is None:
        return None

    settings_obj = SubscriptionSystemSettings.get_solo()
    subscription, _ = PharmacySubscription.objects.get_or_create(
        pharmacy=pharmacy,
        defaults={
            "trial_start_date": timezone.now(),
            "trial_end_date": timezone.now() + timedelta(days=settings_obj.trial_period_days),
            "is_trial_active": True,
            "subscription_status": "trial",
            "monthly_price_usd": settings_obj.monthly_price_usd,
        },
    )
    return subscription


def sync_pharmacy_verification_with_subscription(pharmacy, subscription):
    if pharmacy is None or subscription is None:
        return
    sync_pharmacy_access_flags(pharmacy, subscription)


def sync_subscription_prices(settings_obj):
    exchange_service = ExchangeRateService()
    exchange_rate = exchange_service.get_exchange_rate()
    monthly_price_bif = exchange_service.convert_usd_to_bif(float(settings_obj.monthly_price_usd))

    for subscription in PharmacySubscription.objects.all():
        updated_fields = []
        if subscription.monthly_price_usd != settings_obj.monthly_price_usd:
            subscription.monthly_price_usd = settings_obj.monthly_price_usd
            updated_fields.append("monthly_price_usd")
        if subscription.current_exchange_rate_bif != exchange_rate:
            subscription.current_exchange_rate_bif = exchange_rate
            updated_fields.append("current_exchange_rate_bif")
        if subscription.monthly_price_bif != monthly_price_bif:
            subscription.monthly_price_bif = monthly_price_bif
            updated_fields.append("monthly_price_bif")
        if updated_fields:
            updated_fields.append("updated_at")
            subscription.save(update_fields=updated_fields)


def _count_lost_prescription_opportunities(
    subscriptions,
    prescriptions,
):
    from apps.prescriptions.models import MedicationExtraction, PharmacyStock as RealPharmacyStock

    inactive_subscriptions = [
        subscription
        for subscription in subscriptions
        if subscription.subscription_status in {"expired", "suspended", "cancelled"}
        or (
            subscription.subscription_status == "trial"
            and (
                not subscription.is_trial_active
                or not subscription.trial_end_date
                or timezone.now() > subscription.trial_end_date
            )
        )
    ]
    if not inactive_subscriptions:
        return {}, 0

    stock_names_by_pharmacy_id = {}
    for pharmacy_id, medication_name in RealPharmacyStock.objects.filter(
        pharmacy_id__in=[subscription.pharmacy_id for subscription in inactive_subscriptions],
        is_available=True,
        quantity__gt=0,
    ).values_list("pharmacy_id", "medication_name"):
        stock_names_by_pharmacy_id.setdefault(pharmacy_id, set()).add(normalize_text(medication_name))

    prescription_names = {}
    for prescription_id, medication_name in MedicationExtraction.objects.filter(
        prescription_id__in=[prescription.id for prescription in prescriptions],
        confirmed=True,
    ).values_list("prescription_id", "name"):
        prescription_names.setdefault(prescription_id, set()).add(normalize_text(medication_name))

    lost_counts = {}
    for subscription in inactive_subscriptions:
        stock_names = stock_names_by_pharmacy_id.get(subscription.pharmacy_id) or set()
        if not stock_names:
            lost_counts[subscription.pharmacy_id] = 0
            continue

        count = 0
        for prescription in prescriptions:
            names = prescription_names.get(prescription.id) or set()
            if names and names & stock_names:
                count += 1
        lost_counts[subscription.pharmacy_id] = count

    return lost_counts, sum(lost_counts.values())


class PharmacyViewSet(viewsets.ModelViewSet):
    serializer_class = PharmacySerializer
    parser_classes = [parsers.MultiPartParser, parsers.FormParser, parsers.JSONParser]

    def get_queryset(self):
        user = get_request_user(self.request)
        base_queryset = (
            Pharmacy.objects.filter(is_active=True)
            .annotate(
                prescription_count=Count("prescriptions"),
                response_count=Count("responses"),
            )
            .select_related("subscription")
            .prefetch_related("comments__user__profile__pharmacy")
        )
        if is_admin_user(user):
            return base_queryset
        return base_queryset.filter(id__in=get_active_partner_pharmacies().values("id"))

    @action(detail=True, methods=["post"], url_path="engagement")
    def engagement(self, request, pk=None):
        user = get_request_user(request)
        if user is None or not hasattr(user, "profile") or user.profile.role not in {"pharmacy", "patient"}:
            return Response({"detail": "Connexion requise."}, status=status.HTTP_401_UNAUTHORIZED)

        pharmacy = self.get_object()
        action_name = str(request.data.get("action", "")).strip().lower()
        if action_name not in {"like", "share"}:
            return Response({"detail": "Action d'engagement invalide."}, status=status.HTTP_400_BAD_REQUEST)

        engagement, _ = PharmacyEngagement.objects.get_or_create(pharmacy=pharmacy, user=user)
        if action_name == "like":
            engagement.liked = not engagement.liked
        else:
            engagement.mark_shared()
        engagement.save()

        serialized = self.get_serializer(pharmacy).data
        broadcast_feed_event("pharmacy.engagement.updated", serialized)
        return Response(serialized, status=status.HTTP_200_OK)

    @action(detail=True, methods=["post"], url_path="comments")
    def comments(self, request, pk=None):
        user = get_request_user(request)
        if user is None or not hasattr(user, "profile") or user.profile.role not in {"pharmacy", "patient"}:
            return Response({"detail": "Connexion requise."}, status=status.HTTP_401_UNAUTHORIZED)

        body = str(request.data.get("body", "")).strip()
        if not body:
            return Response({"body": "Le commentaire est obligatoire."}, status=status.HTTP_400_BAD_REQUEST)

        pharmacy = self.get_object()
        comment = PharmacyComment.objects.create(pharmacy=pharmacy, user=user, body=body)

        if user.profile.role == "patient":
            create_targeted_notification(
                title="Nouveau commentaire patient",
                message=f"{user.username} a commente la fiche de {pharmacy.name}.",
                channel="messages:pharmacy",
                recipient_pharmacy=pharmacy,
            )

        serialized_comment = PharmacyCommentSerializer(comment).data
        broadcast_feed_event("pharmacy.comment.created", serialized_comment)
        serialized = self.get_serializer(pharmacy).data
        return Response(serialized, status=status.HTTP_201_CREATED)

    @action(detail=True, methods=["post"], url_path="ban")
    def ban(self, request, pk=None):
        user = get_request_user(request)
        if not is_admin_user(user):
            return Response({"detail": "Acces administrateur requis."}, status=status.HTTP_403_FORBIDDEN)

        pharmacy = Pharmacy.objects.get(pk=pk)
        pharmacy.is_active = False
        pharmacy.save(update_fields=["is_active"])

        linked_profile = getattr(pharmacy, "user_profile", None)
        if linked_profile is not None:
            linked_profile.user.is_active = False
            linked_profile.user.save(update_fields=["is_active"])

        serialized = self.get_serializer(pharmacy).data
        broadcast_feed_event("pharmacy.banned", serialized)
        return Response({"status": "banned", "pharmacy": serialized}, status=status.HTTP_200_OK)

    @action(detail=True, methods=["post"], url_path="unban")
    def unban(self, request, pk=None):
        user = get_request_user(request)
        if not is_admin_user(user):
            return Response({"detail": "Acces administrateur requis."}, status=status.HTTP_403_FORBIDDEN)

        pharmacy = Pharmacy.objects.get(pk=pk)
        pharmacy.is_active = True
        pharmacy.save(update_fields=["is_active"])

        linked_profile = getattr(pharmacy, "user_profile", None)
        if linked_profile is not None:
            linked_profile.user.is_active = True
            linked_profile.user.save(update_fields=["is_active"])

        serialized = self.get_serializer(pharmacy).data
        broadcast_feed_event("pharmacy.unbanned", serialized)
        return Response({"status": "active", "pharmacy": serialized}, status=status.HTTP_200_OK)

    @action(detail=True, methods=["post"], url_path="subscription-status")
    def subscription_status(self, request, pk=None):
        user = get_request_user(request)
        if not is_admin_user(user):
            return Response({"detail": "Acces administrateur requis."}, status=status.HTTP_403_FORBIDDEN)

        pharmacy = Pharmacy.objects.get(pk=pk)
        subscription = ensure_subscription_for_pharmacy(pharmacy)
        next_status = str(request.data.get("subscription_status", "")).strip().lower()
        allowed_statuses = {"active", "trial", "suspended", "cancelled", "expired"}
        if next_status not in allowed_statuses:
            return Response({"detail": "Statut d'abonnement invalide."}, status=status.HTTP_400_BAD_REQUEST)

        subscription.subscription_status = next_status
        if next_status == "active":
            subscription.is_trial_active = False
            if subscription.next_payment_due_date is None or subscription.next_payment_due_date <= timezone.now():
                subscription.next_payment_due_date = timezone.now() + timedelta(days=30)
        elif next_status == "trial":
            settings_obj = SubscriptionSystemSettings.get_solo()
            trial_start = timezone.now()
            subscription.trial_start_date = trial_start
            subscription.trial_end_date = trial_start + timedelta(days=settings_obj.trial_period_days)
            subscription.is_trial_active = True
        else:
            subscription.is_trial_active = False
        subscription.save()
        sync_pharmacy_verification_with_subscription(pharmacy, subscription)

        broadcast_feed_event(
            "pharmacy.subscription.updated",
            {
                "pharmacy_id": pharmacy.id,
                "subscription_status": subscription.subscription_status,
                "is_trial_active": subscription.is_trial_active,
            },
        )
        return Response(
            {
                "pharmacy_id": pharmacy.id,
                "subscription_status": subscription.subscription_status,
                "is_trial_active": subscription.is_trial_active,
            },
            status=status.HTTP_200_OK,
        )

    @action(detail=True, methods=["delete"], url_path="delete-account")
    def delete_account(self, request, pk=None):
        user = get_request_user(request)
        if not is_admin_user(user):
            return Response({"detail": "Acces administrateur requis."}, status=status.HTTP_403_FORBIDDEN)

        pharmacy = Pharmacy.objects.get(pk=pk)
        linked_profile = getattr(pharmacy, "user_profile", None)
        linked_user_id = linked_profile.user_id if linked_profile is not None else None
        pharmacy.delete()
        if linked_profile is not None:
            linked_profile.user.delete()

        broadcast_feed_event("pharmacy.deleted", {"pharmacy_id": int(pk), "user_id": linked_user_id})
        return Response({"deleted": True, "pharmacy_id": int(pk)}, status=status.HTTP_200_OK)


class PrescriptionViewSet(viewsets.ModelViewSet):
    queryset = Prescription.objects.select_related("pharmacy", "patient_user").prefetch_related("responses__pharmacy", "comments__user__profile__pharmacy")
    serializer_class = PrescriptionSerializer
    parser_classes = [parsers.MultiPartParser, parsers.FormParser, parsers.JSONParser]

    def create(self, request, *args, **kwargs):
        user = get_request_user(request)
        if user is None or not hasattr(user, "profile") or user.profile.role != "patient":
            return Response({"detail": "Connexion patient requise."}, status=status.HTTP_401_UNAUTHORIZED)

        payload = request.data.copy()
        payload["patient_name"] = user.username
        payload["patient_email"] = user.email or f"{user.username}@pharmigo.local"

        serializer = self.get_serializer(data=payload)
        serializer.is_valid(raise_exception=True)
        prescription = serializer.save(patient_user=user)

        create_targeted_notification(
            title="Nouvelle ordonnance",
            message=f"L'ordonnance {prescription.public_reference} a ete publiee sur la plateforme.",
            channel="prescriptions:pharmacy",
        )

        serialized = self.get_serializer(prescription, context={"request": request}).data
        broadcast_feed_event("prescription.created", serialized)
        return Response(serialized, status=status.HTTP_201_CREATED)

    @action(detail=True, methods=["post"], url_path="engagement")
    def engagement(self, request, pk=None):
        user = get_request_user(request)
        if user is None or not hasattr(user, "profile") or user.profile.role not in {"pharmacy", "patient"}:
            return Response({"detail": "Connexion requise."}, status=status.HTTP_401_UNAUTHORIZED)

        prescription = self.get_object()
        action_name = str(request.data.get("action", "")).strip().lower()
        if action_name not in {"like", "share"}:
            return Response({"detail": "Action d'engagement invalide."}, status=status.HTTP_400_BAD_REQUEST)

        engagement, _ = PrescriptionEngagement.objects.get_or_create(
            prescription=prescription,
            user=user,
            defaults={"pharmacy": user.profile.pharmacy if user.profile.role == "pharmacy" else None},
        )
        if user.profile.role == "pharmacy" and engagement.pharmacy_id is None:
            engagement.pharmacy = user.profile.pharmacy

        if action_name == "like":
            engagement.liked = not engagement.liked
        elif action_name == "share":
            engagement.mark_shared()

        engagement.save()
        prescription.refresh_from_db()
        serialized = self.get_serializer(prescription).data
        broadcast_feed_event("prescription.engagement.updated", serialized)
        return Response(serialized, status=status.HTTP_200_OK)

    @action(detail=True, methods=["post"], url_path="comments")
    def comments(self, request, pk=None):
        user = get_request_user(request)
        if user is None or not hasattr(user, "profile") or user.profile.role not in {"pharmacy", "patient"}:
            return Response({"detail": "Connexion requise."}, status=status.HTTP_401_UNAUTHORIZED)

        body = str(request.data.get("body", "")).strip()
        if not body:
            return Response({"body": "Le commentaire est obligatoire."}, status=status.HTTP_400_BAD_REQUEST)

        prescription = self.get_object()
        comment = PrescriptionComment.objects.create(
            prescription=prescription,
            user=user,
            body=body,
        )

        if user.profile.role == "patient":
            create_targeted_notification(
                title="Nouveau commentaire patient",
                message=f"Un patient a commente l'ordonnance {prescription.public_reference or prescription.id}.",
                channel="prescriptions:pharmacy",
            )
        else:
            create_targeted_notification(
                title="Nouveau commentaire pharmacie",
                message=f"{user.profile.pharmacy.name} a commente votre ordonnance.",
                channel="prescriptions:patient",
                recipient_user=prescription.patient_user,
            )

        serialized_comment = PrescriptionCommentSerializer(comment).data
        broadcast_feed_event("prescription.comment.created", serialized_comment)
        serialized = self.get_serializer(prescription, context={"request": request}).data
        return Response(serialized, status=status.HTTP_201_CREATED)


class PrescriptionResponseViewSet(viewsets.ModelViewSet):
    queryset = PrescriptionResponse.objects.select_related("pharmacy", "prescription")
    serializer_class = PrescriptionResponseSerializer

    def create(self, request, *args, **kwargs):
        user = get_request_user(request)
        if user is None or not hasattr(user, "profile") or user.profile.role != "pharmacy" or user.profile.pharmacy is None:
            return Response({"detail": "Connexion pharmacie requise."}, status=status.HTTP_401_UNAUTHORIZED)
        if not pharmacy_subscription_is_active(user.profile.pharmacy):
            return Response(
                {"detail": PAYMENT_WALL_MESSAGE},
                status=status.HTTP_403_FORBIDDEN,
            )

        payload = request.data.copy()
        payload["pharmacy"] = user.profile.pharmacy_id
        payload["responder_name"] = user.profile.pharmacy.name

        serializer = self.get_serializer(data=payload)
        serializer.is_valid(raise_exception=True)
        response = serializer.save()

        prescription = response.prescription
        if prescription.status != "reviewed":
            prescription.status = "reviewed"
            prescription.pharmacy = response.pharmacy
            prescription.save(update_fields=["status", "pharmacy"])

        create_targeted_notification(
            title="Interaction pharmacie",
            message=f"{response.pharmacy.name} a reagi a l'ordonnance {prescription.public_reference or prescription.id}.",
            channel="prescriptions:patient",
            recipient_user=prescription.patient_user,
        )

        serialized = self.get_serializer(response).data
        broadcast_feed_event("prescription.response.created", serialized)
        return Response(serialized, status=status.HTTP_201_CREATED)


class ChatMessageViewSet(viewsets.ModelViewSet):
    serializer_class = ChatMessageSerializer

    def get_queryset(self):
        user = get_request_user(self.request)
        return filter_chat_messages_for_user(ChatMessage.objects.all(), user)

    def create(self, request, *args, **kwargs):
        user = get_request_user(request)
        payload = request.data.copy()
        if user is None or not hasattr(user, "profile"):
            return Response({"detail": "Connexion requise."}, status=status.HTTP_401_UNAUTHORIZED)

        recipient_pharmacy_id = payload.get("pharmacy")
        recipient_user_id = payload.get("recipient_user")
        if recipient_pharmacy_id and recipient_user_id:
            return Response({"detail": "Choisissez soit une pharmacie soit un patient."}, status=status.HTTP_400_BAD_REQUEST)

        if user.profile.role == "patient":
            if not recipient_pharmacy_id:
                return Response({"pharmacy": ["Choisissez une pharmacie."]}, status=status.HTTP_400_BAD_REQUEST)
            payload["sender_user"] = user.id
            payload["sender_name"] = user.username
            payload["sender_role"] = "patient"
            payload["sender_pharmacy"] = None
            payload["recipient_user"] = None
        elif user.profile.role == "pharmacy" and user.profile.pharmacy is not None:
            payload["sender_pharmacy"] = user.profile.pharmacy_id
            payload["sender_name"] = user.profile.pharmacy.name
            payload["sender_role"] = "pharmacy"
            payload["sender_user"] = None

            if recipient_user_id:
                try:
                    recipient_user = User.objects.select_related("profile").get(pk=recipient_user_id)
                except User.DoesNotExist:
                    return Response({"recipient_user": ["Patient introuvable."]}, status=status.HTTP_400_BAD_REQUEST)
                if not pharmacy_can_message_patient(user.profile.pharmacy, recipient_user):
                    return Response(
                        {"recipient_user": ["Cette conversation patient n'est pas encore autorisee pour votre pharmacie."]},
                        status=status.HTTP_400_BAD_REQUEST,
                    )
                payload["pharmacy"] = None
            elif recipient_pharmacy_id:
                payload["recipient_user"] = None
            else:
                return Response({"detail": "Choisissez un destinataire."}, status=status.HTTP_400_BAD_REQUEST)
        else:
            return Response({"detail": "Connexion patient ou pharmacie requise."}, status=status.HTTP_401_UNAUTHORIZED)

        serializer = self.get_serializer(data=payload)
        serializer.is_valid(raise_exception=True)
        message = serializer.save()

        if message.recipient_user_id:
            create_targeted_notification(
                title="Message patient",
                message=f"{message.sender_name} vous a envoye un message sur PharmiGo.",
                channel="messages:patient",
                recipient_user=message.recipient_user,
            )
        elif message.pharmacy_id:
            create_targeted_notification(
                title="Message pharmacie",
                message=f"{message.sender_name} a envoye un message visible sur la plateforme.",
                channel="messages:pharmacy",
                recipient_pharmacy=message.pharmacy,
            )

        serialized = self.get_serializer(message).data
        broadcast_feed_event("message.created", serialized)
        return Response(serialized, status=status.HTTP_201_CREATED)


class NotificationViewSet(viewsets.ModelViewSet):
    serializer_class = NotificationSerializer

    def get_queryset(self):
        user = get_request_user(self.request)
        return filter_notifications_for_user(Notification.objects.all(), user)

    @action(detail=False, methods=["patch", "post"], url_path="mark-all-read")
    def mark_all_read(self, request):
        user = get_request_user(request)
        queryset = filter_notifications_for_user(Notification.objects.all(), user).filter(is_read=False)
        updated_count = queryset.update(is_read=True)
        return Response({"updated": updated_count}, status=status.HTTP_200_OK)

    @action(detail=False, methods=["delete"], url_path="clear-all")
    def clear_all(self, request):
        user = get_request_user(request)
        queryset = filter_notifications_for_user(Notification.objects.all(), user)
        deleted_count, _ = queryset.delete()
        return Response({"deleted": deleted_count}, status=status.HTTP_200_OK)

    @action(detail=False, methods=["post"], url_path="broadcast")
    def broadcast(self, request):
        user = get_request_user(request)
        if not is_admin_user(user):
            return Response({"detail": "Acces administrateur requis."}, status=status.HTTP_403_FORBIDDEN)

        title = str(request.data.get("title", "")).strip()
        message = str(request.data.get("message", "")).strip()
        audience = str(request.data.get("audience", "all")).strip().lower()

        if not title or not message:
            return Response({"detail": "Le titre et le message sont obligatoires."}, status=status.HTTP_400_BAD_REQUEST)

        if not title.lower().startswith("from admin:"):
            title = f"From Admin: {title}"

        created = []
        if audience == "all":
            created.append(create_targeted_notification(title, message, "system"))
        elif audience == "patients":
            for profile in UserProfile.objects.select_related("user").filter(role="patient", user__is_active=True):
                created.append(create_targeted_notification(title, message, "prescriptions:patient", recipient_user=profile.user))
        elif audience == "pharmacies":
            for profile in UserProfile.objects.select_related("pharmacy").filter(role="pharmacy", pharmacy__isnull=False, user__is_active=True):
                created.append(create_targeted_notification(title, message, "messages:pharmacy", recipient_pharmacy=profile.pharmacy))
        else:
            return Response({"detail": "Audience invalide."}, status=status.HTTP_400_BAD_REQUEST)

        payload = NotificationSerializer(created, many=True).data
        broadcast_feed_event("notification.broadcast", {"audience": audience, "count": len(payload)})
        return Response({"created": payload, "count": len(payload)}, status=status.HTTP_201_CREATED)


class UserViewSet(viewsets.ReadOnlyModelViewSet):
    queryset = User.objects.all()
    serializer_class = UserSerializer

    @action(detail=True, methods=["post"], url_path="ban")
    def ban(self, request, pk=None):
        actor = get_request_user(request)
        if not is_admin_user(actor):
            return Response({"detail": "Acces administrateur requis."}, status=status.HTTP_403_FORBIDDEN)

        target = self.get_object()
        target.is_active = False
        target.save(update_fields=["is_active"])

        profile = getattr(target, "profile", None)
        if profile is not None and profile.role == "pharmacy" and profile.pharmacy is not None:
            profile.pharmacy.is_active = False
            profile.pharmacy.save(update_fields=["is_active"])

        broadcast_feed_event("user.banned", {"user_id": target.id})
        return Response({"status": "banned", "user_id": target.id}, status=status.HTTP_200_OK)

    @action(detail=True, methods=["post"], url_path="unban")
    def unban(self, request, pk=None):
        actor = get_request_user(request)
        if not is_admin_user(actor):
            return Response({"detail": "Acces administrateur requis."}, status=status.HTTP_403_FORBIDDEN)

        target = self.get_object()
        target.is_active = True
        target.save(update_fields=["is_active"])

        profile = getattr(target, "profile", None)
        if profile is not None and profile.role == "pharmacy" and profile.pharmacy is not None:
            profile.pharmacy.is_active = True
            profile.pharmacy.save(update_fields=["is_active"])

        broadcast_feed_event("user.unbanned", {"user_id": target.id})
        return Response({"status": "active", "user_id": target.id}, status=status.HTTP_200_OK)

    @action(detail=True, methods=["delete"], url_path="delete-account")
    def delete_account(self, request, pk=None):
        actor = get_request_user(request)
        if not is_admin_user(actor):
            return Response({"detail": "Acces administrateur requis."}, status=status.HTTP_403_FORBIDDEN)

        target = self.get_object()
        target_id = target.id
        profile = getattr(target, "profile", None)
        pharmacy_id = getattr(getattr(profile, "pharmacy", None), "id", None)
        target.delete()
        broadcast_feed_event("user.deleted", {"user_id": target_id, "pharmacy_id": pharmacy_id})
        return Response({"deleted": True, "user_id": target_id}, status=status.HTTP_200_OK)


router = routers.DefaultRouter()
router.register("users", UserViewSet, basename="users")
router.register("pharmacies", PharmacyViewSet, basename="pharmacies")
router.register("prescriptions", PrescriptionViewSet, basename="prescriptions")
router.register("prescription-responses", PrescriptionResponseViewSet, basename="prescription-responses")
router.register("messages", ChatMessageViewSet, basename="messages")
router.register("notifications", NotificationViewSet, basename="notifications")

ENDPOINT_CATALOG = [
    {"name": "auth_register", "method": "POST", "path": "/api/auth/register/"},
    {"name": "auth_login", "method": "POST", "path": "/api/auth/login/"},
    {"name": "auth_logout", "method": "POST", "path": "/api/auth/logout/"},
    {"name": "health", "method": "GET", "path": "/api/health/"},
    {"name": "app_config", "method": "GET", "path": "/api/app-config/"},
    {"name": "dashboard", "method": "GET", "path": "/api/dashboard/"},
    {"name": "admin_dashboard", "method": "GET,PATCH", "path": "/api/admin/dashboard/"},
    {"name": "profile", "method": "GET,PATCH", "path": "/api/profile/"},
    {"name": "endpoints", "method": "GET", "path": "/api/endpoints/"},
    {"name": "users", "method": "GET", "path": "/api/users/"},
    {"name": "pharmacies", "method": "GET,POST", "path": "/api/pharmacies/"},
    {"name": "pharmacy_detail", "method": "GET,PUT,PATCH,DELETE", "path": "/api/pharmacies/{id}/"},
    {"name": "prescriptions", "method": "GET,POST", "path": "/api/prescriptions/"},
    {"name": "prescription_detail", "method": "GET,PUT,PATCH,DELETE", "path": "/api/prescriptions/{id}/"},
    {"name": "prescription_responses", "method": "GET,POST", "path": "/api/prescription-responses/"},
    {"name": "messages", "method": "GET,POST", "path": "/api/messages/"},
    {"name": "notifications", "method": "GET,POST", "path": "/api/notifications/"},
    {"name": "presence_heartbeat", "method": "POST", "path": "/api/presence/heartbeat/"},
    {"name": "presence_offline", "method": "POST", "path": "/api/presence/offline/"},
    {"name": "websocket_chat", "method": "WS", "path": "/ws/chat/{room_name}/"},
]


@api_view(["GET"])
def health_check(request):
    return Response(
        {
            "name": "PharmiGo",
            "status": "ok",
            "frontend": settings.FRONTEND_APP_URL,
            "api": "/api/",
        }
    )


@api_view(["POST"])
def presence_heartbeat(request):
    user = get_request_user(request)
    if user is None or not hasattr(user, "profile"):
        return Response({"detail": "Connexion requise."}, status=status.HTTP_401_UNAUTHORIZED)

    profile = user.profile
    refresh_profile_location_from_request(profile, request)
    profile.touch_presence()
    payload = build_presence_payload(profile)
    broadcast_feed_event("presence.updated", payload)
    return Response(payload, status=status.HTTP_200_OK)


@api_view(["POST"])
def presence_offline(request):
    user = get_request_user(request)
    if user is None or not hasattr(user, "profile"):
        return Response({"detail": "Connexion requise."}, status=status.HTTP_401_UNAUTHORIZED)

    profile = user.profile
    profile.force_offline()
    payload = build_presence_payload(profile)
    broadcast_feed_event("presence.updated", payload)
    return Response(payload, status=status.HTTP_200_OK)


@api_view(["GET"])
def app_config(request):
    return Response(
        {
            "product": {
                "name": "PharmiGo",
                "vision": "Digitaliser la recherche de medicaments et diffuser les ordonnances en temps reel.",
                "countries": ["RDC", "Burundi"],
            },
            "actors": [
                "Patient",
                "Pharmacie",
                "Administrateur",
                "IA",
                "Blockchain",
            ],
            "features": [
                "Upload ordonnance",
                "Diffusion temps reel",
                "Reponses pharmacies",
                "Chat",
                "Notifications",
            ],
            "security": [
                "Authentification",
                "Chiffrement",
                "Protection des donnees medicales",
            ],
            "evolution": [
                "Paiement",
                "Livraison",
                "Teleconsultation",
            ],
            "languages": ["fr", "en", "rn", "sw", "ln"],
            "themes": ["light", "dark", "system"],
        }
    )


@api_view(["GET"])
def dashboard(request):
    user = get_request_user(request)
    excluded_prescription_emails = [
        "aisha@demo.local",
        "patrick@demo.local",
        "test.patient@example.com",
        "patient_patch_test@pharmigo.local",
    ]
    excluded_prescription_names = ["Aisha N.", "Patrick B.", "Test Patient", "patient_patch_test"]
    excluded_message_senders = ["Equipe PharmiGo"]

    # Fetch actual data for the dashboard
    excluded_pharmacy_names = [
        "PharmiGo Centre Ville",
        "PharmiGo Gitega",
        "PharmiGo Kinindo",
    ]
    pharmacies = Pharmacy.objects.filter(is_active=True).exclude(name__in=excluded_pharmacy_names)
    prescription_queryset = (
        Prescription.objects.exclude(patient_email__in=excluded_prescription_emails)
        .exclude(patient_name__in=excluded_prescription_names)
        .exclude(status__in=["error", "cancelled"])
    )
    if user is None:
        prescription_queryset = prescription_queryset.filter(
            status__in=["confirmed", "searching", "pharmacy_selected", "preparing", "ready", "served", "patient_confirmed", "completed"]
        )
    elif is_admin_user(user):
        pass
    elif hasattr(user, "profile") and user.profile.role == "patient":
        patient_start_at = getattr(user.profile, "created_at", None)
        prescription_queryset = prescription_queryset.filter(patient_user=user)
        if patient_start_at is not None:
            prescription_queryset = prescription_queryset.filter(created_at__gte=patient_start_at)
    elif hasattr(user, "profile") and user.profile.role == "pharmacy":
        prescription_queryset = prescription_queryset.filter(
            status__in=[
                "uploaded",
                "analyzing",
                "confirmation_pending",
                "confirmed",
                "searching",
                "pharmacy_selected",
                "preparing",
                "ready",
                "served",
                "patient_confirmed",
                "completed",
            ]
        )
    else:
        prescription_queryset = prescription_queryset.none()
    response_queryset = PrescriptionResponse.objects.filter(prescription__in=prescription_queryset)
    notification_queryset = filter_notifications_for_user(Notification.objects.all(), user) if user else Notification.objects.none()
    message_queryset = ChatMessage.objects.exclude(sender_name__in=excluded_message_senders)

    # Serialize pharmacies
    from apps.pharmacies.serializers import PharmacySerializer
    pharmacy_data = PharmacySerializer(pharmacies, many=True, context={'request': request}).data
    prescription_data = PrescriptionSerializer(
        prescription_queryset.select_related("pharmacy", "patient_user").prefetch_related("responses__pharmacy", "comments__user__profile__pharmacy"),
        many=True,
        context={"request": request},
    ).data
    response_data = PrescriptionResponseSerializer(
        response_queryset.select_related("pharmacy", "prescription"),
        many=True,
    ).data
    notification_data = NotificationSerializer(notification_queryset.order_by("-created_at")[:30], many=True).data
    filtered_messages = filter_chat_messages_for_user(message_queryset, user) if user else ChatMessage.objects.none()
    message_data = ChatMessageSerializer(filtered_messages.order_by("-created_at")[:80], many=True).data

    kpis = {
        "response_time_minutes": round(float(response_queryset.aggregate(value=Avg("estimated_minutes")).get("value") or 0), 1),
        "resolution_rate": 89,
        "satisfaction_score": 4.7,
        "active_pharmacies": pharmacies.count(),
        "live_prescriptions": prescription_queryset.count(),
        "active_prescriptions": prescription_queryset.exclude(status__in=["completed", "cancelled"]).count(),
        "confirmed_quotes": response_queryset.filter(status__in=["quoted", "confirmed"]).count(),
    }

    journeys = {
        "patient": ["upload", "responses", "choice"],
        "pharmacy": ["reception", "response", "confirmation"],
    }

    return Response(
        {
            "kpis": kpis,
            "journeys": journeys,
            "pharmacies": pharmacy_data,
            "prescriptions": prescription_data,
            "responses": response_data,
            "notifications": notification_data,
            "messages": message_data,
        }
    )


@api_view(["GET", "PATCH"])
def admin_dashboard(request):
    user = get_request_user(request)
    if not is_admin_user(user):
        return Response({"detail": "Acces administrateur requis."}, status=status.HTTP_403_FORBIDDEN)

    settings_obj = SubscriptionSystemSettings.get_solo()
    ai_settings_obj = PharmiGoAISettings.get_solo()

    if request.method == "PATCH":
        update_fields = ["updated_by", "updated_at"]
        ai_update_fields = []

        if "trial_period_days" in request.data:
            try:
                trial_period_days = int(request.data.get("trial_period_days"))
            except (TypeError, ValueError):
                return Response({"trial_period_days": "Valeur invalide."}, status=status.HTTP_400_BAD_REQUEST)

            if trial_period_days < 1 or trial_period_days > 3650:
                return Response(
                    {"trial_period_days": "La duree d'essai doit etre comprise entre 1 et 3650 jours."},
                    status=status.HTTP_400_BAD_REQUEST,
                )

            settings_obj.trial_period_days = trial_period_days
            update_fields.append("trial_period_days")

            for subscription in PharmacySubscription.objects.filter(subscription_status="trial", is_trial_active=True):
                trial_start = subscription.trial_start_date or timezone.now()
                subscription.trial_end_date = trial_start + timedelta(days=trial_period_days)
                if timezone.now() > subscription.trial_end_date:
                    subscription.is_trial_active = False
                    subscription.subscription_status = "expired"
                    subscription.save(update_fields=["trial_end_date", "is_trial_active", "subscription_status", "updated_at"])
                else:
                    subscription.save(update_fields=["trial_end_date", "updated_at"])

        if "monthly_price_usd" in request.data:
            try:
                monthly_price_usd = float(request.data.get("monthly_price_usd"))
            except (TypeError, ValueError):
                return Response({"monthly_price_usd": "Valeur invalide."}, status=status.HTTP_400_BAD_REQUEST)

            if monthly_price_usd <= 0:
                return Response({"monthly_price_usd": "Le prix mensuel doit etre superieur a zero."}, status=status.HTTP_400_BAD_REQUEST)

            settings_obj.monthly_price_usd = monthly_price_usd
            update_fields.append("monthly_price_usd")

        if "payment_methods" in request.data:
            settings_obj.payment_methods = sanitize_payment_methods(request.data.get("payment_methods"))
            update_fields.append("payment_methods")

        ai_settings_payload = request.data.get("ai_settings")
        if isinstance(ai_settings_payload, dict):
            ai_boolean_fields = [
                "human_layer",
                "learning_passif",
                "fallback_ai",
                "memory_engine",
                "semantic_search",
                "local_reasoning",
            ]
            for field_name in ai_boolean_fields:
                if field_name in ai_settings_payload:
                    setattr(ai_settings_obj, field_name, bool(ai_settings_payload.get(field_name)))
                    ai_update_fields.append(field_name)

        settings_obj.updated_by = user
        settings_obj.save(update_fields=update_fields)
        sync_subscription_prices(settings_obj)
        if ai_update_fields:
            ai_update_fields.append("updated_at")
            ai_settings_obj.save(update_fields=ai_update_fields)
            AIEventLogger.log(
                "config_change",
                "Configuration PharmiGo AI mise a jour depuis le dashboard admin.",
                severity="info",
                payload={field: getattr(ai_settings_obj, field) for field in ai_update_fields if field != "updated_at"},
            )

    pharmacies = Pharmacy.objects.all().order_by("-created_at")
    for pharmacy in pharmacies:
        ensure_subscription_for_pharmacy(pharmacy)
    users = User.objects.select_related("profile", "profile__pharmacy").all().order_by("-id")
    prescriptions = (
        Prescription.objects.select_related("pharmacy", "patient_user")
        .prefetch_related("responses__pharmacy", "comments__user__profile__pharmacy", "extracted_medications")
        .defer("total_amount")
        .order_by("-created_at")
    )
    responses = PrescriptionResponse.objects.order_by("-created_at")
    notifications = Notification.objects.order_by("-created_at")
    messages = ChatMessage.objects.select_related("pharmacy", "sender_pharmacy").order_by("-created_at")
    subscriptions = PharmacySubscription.objects.select_related("pharmacy").order_by("-updated_at")
    payments = SubscriptionPayment.objects.select_related("pharmacy", "verified_by").order_by("-created_at")
    recent_prescriptions = list(
        prescriptions.filter(created_at__gte=timezone.now() - timedelta(days=7))[:500]
    )
    lost_counts_by_pharmacy_id, lost_total = _count_lost_prescription_opportunities(subscriptions, recent_prescriptions)

    active_trials = subscriptions.filter(subscription_status="trial", is_trial_active=True).count()
    active_paid = subscriptions.filter(subscription_status="active").count()
    expired_subscriptions = subscriptions.filter(subscription_status__in=["expired", "suspended", "cancelled"]).count()
    learning_events = ChatbotLearningData.objects.all()
    learning_total = learning_events.count()
    improved_events = learning_events.filter(confidence_after__gt=0).count()
    avg_confidence_before = (
        sum(item.confidence_before for item in learning_events[:500]) / min(learning_total, 500)
        if learning_total
        else 0
    )
    avg_confidence_after = (
        sum(item.confidence_after for item in learning_events[:500]) / min(learning_total, 500)
        if learning_total
        else 0
    )

    user_data = [
        {
            "id": account.id,
            "username": account.username,
            "email": account.email,
            "is_staff": account.is_staff,
            "is_active": account.is_active,
            "role": getattr(getattr(account, "profile", None), "role", "admin" if account.is_staff else "guest"),
            "pharmacy_name": getattr(getattr(getattr(account, "profile", None), "pharmacy", None), "name", ""),
        }
        for account in users[:100]
    ]

    subscription_data = [
        {
            "id": subscription.id,
            "pharmacy_id": subscription.pharmacy_id,
            "pharmacy_name": subscription.pharmacy.name,
            "subscription_status": subscription.subscription_status,
            "is_trial_active": subscription.is_trial_active,
            "trial_start_date": subscription.trial_start_date,
            "trial_end_date": subscription.trial_end_date,
            "days_remaining": max(0, (subscription.trial_end_date - timezone.now()).days) if subscription.trial_end_date else 0,
            "monthly_price_usd": subscription.monthly_price_usd,
            "monthly_price_bif": subscription.monthly_price_bif,
            "lost_prescriptions_count": lost_counts_by_pharmacy_id.get(subscription.pharmacy_id, 0),
        }
        for subscription in subscriptions[:100]
    ]

    payment_data = [
        {
            "id": payment.id,
            "pharmacy_id": payment.pharmacy_id,
            "pharmacy_name": payment.pharmacy.name,
            "amount_usd": payment.amount_usd,
            "amount_bif": payment.amount_bif,
            "currency": payment.currency,
            "payment_method": payment.payment_method,
            "payer_name": payment.payer_name,
            "payer_address": payment.payer_address,
            "sender_phone": payment.sender_phone,
            "receiver_phone": payment.receiver_phone,
            "payment_status": payment.payment_status,
            "transaction_reference": payment.transaction_reference,
            "proof_image": payment.proof_image.url if payment.proof_image else None,
            "payment_month": payment.payment_month,
            "verified_at": payment.verified_at,
            "verified_by_name": payment.verified_by.username if payment.verified_by else None,
            "created_at": payment.created_at,
        }
        for payment in payments[:100]
    ]

    prescription_data = PrescriptionSerializer(
        prescriptions[:100],
        many=True,
        context={"request": request},
    ).data

    response_data = list(
        responses.values(
            "id",
            "prescription_id",
            "pharmacy_id",
            "pharmacy__name",
            "responder_name",
            "availability_note",
            "estimated_minutes",
            "status",
            "created_at",
        )[:100]
    )

    ai_runtime_config = AIConfigService.get_current_config()
    gemini_service = GeminiChatService()
    ai_learning_audit = list(
        LearnedMedicalPattern.objects.order_by("-created_at").values(
            "id",
            "source",
            "detected_intent",
            "created_at",
            original_text=F("user_query"),
            corrected_medicine=Value("", output_field=CharField()),
            confidence_before=Value(0.0, output_field=FloatField()),
            confidence_after=F("confidence_score"),
        )[:20]
    )
    ai_recent_logs = list(
        PharmiGoAIEventLog.objects.order_by("-created_at").values(
            "id",
            "event_type",
            "severity",
            "message",
            "payload",
            "created_at",
        )[:10]
    )

    return Response(
        {
            "generated_at": timezone.now(),
            "settings": SubscriptionSystemSettingsSerializer(settings_obj).data,
            "summary": {
                "users_total": users.count(),
                "pharmacies_total": pharmacies.count(),
                "prescriptions_total": prescriptions.count(),
                "responses_total": responses.count(),
                "notifications_total": notifications.count(),
                "messages_total": messages.count(),
                "subscriptions_total": subscriptions.count(),
                "payments_total": payments.count(),
                "trial_pharmacies": active_trials,
                "active_paid_pharmacies": active_paid,
                "expired_or_limited_pharmacies": expired_subscriptions,
                "lost_prescriptions_total": lost_total,
            },
            "chatbot_metrics": {
                "learning_events_total": learning_total,
                "improved_events_total": improved_events,
                "average_confidence_before": round(avg_confidence_before, 3),
                "average_confidence_after": round(avg_confidence_after, 3),
                "success_rate": round((improved_events / learning_total) * 100, 1) if learning_total else 0,
                "failure_rate": round(((learning_total - improved_events) / learning_total) * 100, 1) if learning_total else 0,
            },
            "users": user_data,
            "pharmacies": PharmacySerializer(pharmacies[:100], many=True, context={"request": request}).data,
            "prescriptions": prescription_data,
            "responses": response_data,
            "notifications": NotificationSerializer(notifications[:100], many=True).data,
            "messages": ChatMessageSerializer(messages[:100], many=True).data,
            "subscriptions": subscription_data,
            "payments": payment_data,
            "ai_settings": ai_runtime_config,
            "ai_health": {
                "gemini_enabled": bool(getattr(settings, "GEMINI_ENABLED", True)),
                "gemini_configured": bool(getattr(settings, "GEMINI_API_KEY", "").strip()),
                "gemini_available": bool(gemini_service.available),
                "gemini_model": gemini_service.model,
            },
            "ai_learning_audit": ai_learning_audit,
            "ai_recent_logs": ai_recent_logs,
        }
    )


@api_view(["GET", "PATCH"])
def profile(request):
    user = get_request_user(request)
    if user is None:
        return Response({"detail": "Utilisateur non authentifie."}, status=status.HTTP_401_UNAUTHORIZED)

    if user.is_staff and not hasattr(user, "profile"):
        ensured_admin = ensure_default_admin_user()
        if ensured_admin is not None:
            user = get_request_user(request)

    if request.method == "GET":
        payload = UserSerializer(user).data
        if hasattr(user, "profile") and user.profile.role == "patient":
            patient_history_queryset = Prescription.objects.filter(patient_user=user).select_related("pharmacy").prefetch_related("responses__pharmacy")
            patient_start_at = getattr(user.profile, "created_at", None)
            if patient_start_at is not None:
                patient_history_queryset = patient_history_queryset.filter(created_at__gte=patient_start_at)
            payload["history"] = {
                "prescriptions": PrescriptionSerializer(
                    patient_history_queryset[:20],
                    many=True,
                    context={"request": request},
                ).data
            }
        elif hasattr(user, "profile") and user.profile.role == "pharmacy" and user.profile.pharmacy is not None:
            pharmacy = user.profile.pharmacy
            pharmacy_start_at = max(
                [dt for dt in [getattr(user.profile, "created_at", None), getattr(pharmacy, "created_at", None)] if dt is not None],
                default=None,
            )
            message_queryset = filter_chat_messages_for_user(ChatMessage.objects.all(), user)
            response_queryset = PrescriptionResponse.objects.filter(pharmacy=pharmacy).select_related("pharmacy", "prescription")
            if pharmacy_start_at is not None:
                message_queryset = message_queryset.filter(created_at__gte=pharmacy_start_at)
                response_queryset = response_queryset.filter(created_at__gte=pharmacy_start_at)
            payload["history"] = {
                "messages": ChatMessageSerializer(message_queryset[:20], many=True).data,
                "responses": PrescriptionResponseSerializer(response_queryset[:20], many=True).data,
            }
        return Response(payload)

    profile = getattr(user, "profile", None)
    data = request.data

    def coerce_optional_float(value):
        if value in (None, ""):
            return None
        try:
            return float(value)
        except (TypeError, ValueError):
            return None

    if profile is not None:
        latitude = coerce_optional_float(data.get("latitude"))
        longitude = coerce_optional_float(data.get("longitude"))
        location_city = str(data.get("location_city", "")).strip()
        location_country = str(data.get("location_country", "")).strip()
        if latitude is not None or longitude is not None or location_city or location_country:
            sync_profile_coordinates(
                profile,
                latitude=latitude,
                longitude=longitude,
                city=location_city,
                country=location_country,
            )

    if user.is_staff:
        username = str(data.get("username", user.username)).strip() or user.username
        email = str(data.get("email", user.email)).strip().lower()

        if User.objects.exclude(pk=user.pk).filter(username=username).exists():
            return Response({"username": ["Ce nom d'utilisateur est deja utilise."]}, status=status.HTTP_400_BAD_REQUEST)
        if not email:
            return Response({"email": ["L'adresse email est obligatoire."]}, status=status.HTTP_400_BAD_REQUEST)
        if email_already_used(email, exclude_user_id=user.pk):
            return Response({"email": ["Cette adresse email est deja utilisee."]}, status=status.HTTP_400_BAD_REQUEST)

        user.username = username
        user.email = email
        user.save(update_fields=["username", "email"])

        if profile is not None and request.FILES.get("profile_image"):
            profile.profile_image = request.FILES["profile_image"]
            profile.save(update_fields=["profile_image"])

        return Response(UserSerializer(user).data)

    if profile and profile.role == "patient":
        username = str(data.get("username", "")).strip()
        email = str(data.get("email", user.email)).strip().lower()
        try:
            phone_number = normalize_phone_number(str(data.get("phone_number", "")))
        except Exception as exc:
            return Response({"phone_number": [str(exc)]}, status=status.HTTP_400_BAD_REQUEST)

        if not username:
            return Response({"username": ["Le nom d'utilisateur est obligatoire."]}, status=status.HTTP_400_BAD_REQUEST)
        if not email:
            return Response({"email": ["L'adresse email est obligatoire."]}, status=status.HTTP_400_BAD_REQUEST)
        if User.objects.exclude(pk=user.pk).filter(username=username).exists():
            return Response({"username": ["Ce nom d'utilisateur est deja utilise."]}, status=status.HTTP_400_BAD_REQUEST)
        if email_already_used(email, exclude_user_id=user.pk):
            return Response({"email": ["Cette adresse email est deja utilisee."]}, status=status.HTTP_400_BAD_REQUEST)
        if phone_number_already_used(phone_number, exclude_profile_id=profile.pk):
            return Response({"phone_number": ["Ce numero de telephone est deja utilise."]}, status=status.HTTP_400_BAD_REQUEST)

        user.username = username
        user.email = email
        user.save(update_fields=["username", "email"])
        profile.phone_number = phone_number
        if request.FILES.get("profile_image"):
            profile.profile_image = request.FILES["profile_image"]
            profile.save(update_fields=["phone_number", "profile_image"])
        else:
            profile.save(update_fields=["phone_number"])
        return Response(UserSerializer(user).data)

    if profile and profile.role == "pharmacy" and profile.pharmacy is not None:
        pharmacy = profile.pharmacy
        email = str(data.get("email", pharmacy.email)).strip().lower()
        try:
            phone_number = normalize_phone_number(str(data.get("phone_number", pharmacy.phone_number)))
        except Exception as exc:
            return Response({"phone_number": [str(exc)]}, status=status.HTTP_400_BAD_REQUEST)
        if not email:
            return Response({"email": ["L'adresse email est obligatoire."]}, status=status.HTTP_400_BAD_REQUEST)
        if email_already_used(email, exclude_user_id=user.pk, exclude_pharmacy_id=pharmacy.pk):
            return Response({"email": ["Cette adresse email est deja utilisee."]}, status=status.HTTP_400_BAD_REQUEST)
        if phone_number_already_used(phone_number, exclude_profile_id=profile.pk, exclude_pharmacy_id=pharmacy.pk):
            return Response({"phone_number": ["Ce numero de telephone est deja utilise."]}, status=status.HTTP_400_BAD_REQUEST)
        pharmacy.name = str(data.get("pharmacy_name", pharmacy.name)).strip() or pharmacy.name
        pharmacy.city = str(data.get("city", pharmacy.city)).strip() or pharmacy.city
        pharmacy.address = str(data.get("address", pharmacy.address)).strip() or pharmacy.address
        pharmacy.phone_number = phone_number
        pharmacy.email = email
        pharmacy.opening_hours = str(data.get("opening_hours", pharmacy.opening_hours)).strip() or pharmacy.opening_hours
        pharmacy.delivery_supported = str(data.get("delivery_supported", pharmacy.delivery_supported)).lower() in {"true", "1", "yes", "on"}
        if request.FILES.get("pharmacy_image"):
            pharmacy.profile_image = request.FILES["pharmacy_image"]
        pharmacy.save()
        if email:
            user.email = email
            user.save(update_fields=["email"])

        profile.phone_number = phone_number
        profile.whatsapp_number = phone_number
        profile.address = pharmacy.address
        profile.save(update_fields=["phone_number", "whatsapp_number", "address"])

        broadcast_feed_event(
            "pharmacy.updated",
            PharmacySerializer(pharmacy, context={"request": request}).data,
        )

        return Response(UserSerializer(user).data)

    return Response(UserSerializer(user).data)


@api_view(["GET"])
def endpoints(request):
    return Response(ENDPOINT_CATALOG)
