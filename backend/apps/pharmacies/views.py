import mimetypes
from pathlib import Path

from django.contrib.auth import get_user_model
from django.http import FileResponse, Http404, HttpResponse
from rest_framework import generics, permissions, status
from rest_framework.views import APIView
from rest_framework.response import Response
from django.utils import timezone
from datetime import timedelta
from .models import Pharmacy, PharmacyContact, PharmacySubscription, SubscriptionPayment, SubscriptionSystemSettings
from .serializers import PharmacySerializer, PharmacyContactSerializer, PharmacySubscriptionSerializer, SubscriptionPaymentSerializer
from .payment_config import build_payment_details
from .services.access import get_active_partner_pharmacies, is_pharmacy_partner_eligible
from .services.exchange_rate_service import ExchangeRateService
from .services.rewards import build_pharmacy_reward_payload, safe_mark_payment_validated_for_pharmacy
from pharmigo.api import broadcast_feed_event, create_targeted_notification, sync_pharmacy_verification_with_subscription

User = get_user_model()

# Pharmacy CRUD
class PharmacyListView(generics.ListCreateAPIView):
    serializer_class = PharmacySerializer

    def get_queryset(self):
        queryset = Pharmacy.objects.select_related("subscription").all()
        user = getattr(self.request, "user", None)
        if user is not None and getattr(user, "is_authenticated", False) and getattr(user, "is_staff", False):
            return queryset
        return queryset.filter(id__in=get_active_partner_pharmacies().values("id"))

class PharmacyDetailView(generics.RetrieveAPIView):
    serializer_class = PharmacySerializer

    def get_queryset(self):
        queryset = Pharmacy.objects.select_related("subscription").all()
        user = getattr(self.request, "user", None)
        if user is not None and getattr(user, "is_authenticated", False) and getattr(user, "is_staff", False):
            return queryset
        return queryset.filter(id__in=get_active_partner_pharmacies().values("id"))


class PharmacyProfileImageView(APIView):
    permission_classes = [permissions.AllowAny]

    def get(self, request, pk: int):
        pharmacy = Pharmacy.objects.select_related("subscription", "user_profile__user").filter(pk=pk, is_active=True).first()
        if pharmacy is None:
            raise Http404("Pharmacie introuvable.")

        actor = getattr(request, "user", None)
        actor_profile = getattr(actor, "profile", None) if getattr(actor, "is_authenticated", False) else None
        can_access_private_preview = bool(
            getattr(actor, "is_staff", False)
            or (actor_profile is not None and getattr(actor_profile, "pharmacy_id", None) == pharmacy.id)
        )

        if not can_access_private_preview and not is_pharmacy_partner_eligible(pharmacy):
            raise Http404("Image indisponible.")

        image_field = pharmacy.profile_image
        if image_field and image_field.name:
            storage = image_field.storage
            if storage.exists(image_field.name):
                content_type, _ = mimetypes.guess_type(image_field.name)
                image_file = storage.open(image_field.name, "rb")
                response = FileResponse(image_file, content_type=content_type or "application/octet-stream")
                response["Cache-Control"] = "private, no-store, max-age=0, must-revalidate"
                response["Pragma"] = "no-cache"
                return response

        if pharmacy.profile_image_blob:
            response = HttpResponse(
                pharmacy.profile_image_blob,
                content_type=pharmacy.profile_image_content_type or "application/octet-stream",
            )
            response["Cache-Control"] = "private, no-store, max-age=0, must-revalidate"
            response["Pragma"] = "no-cache"
            if pharmacy.profile_image_original_name:
                response["Content-Disposition"] = f'inline; filename="{pharmacy.profile_image_original_name}"'
            return response

        raise Http404("Fichier image introuvable.")

# Contact management
class PharmacyContactListView(generics.ListCreateAPIView):
    queryset = PharmacyContact.objects.all()
    serializer_class = PharmacyContactSerializer
    permission_classes = [permissions.IsAuthenticated]

class PharmacyContactDetailView(generics.RetrieveAPIView):
    queryset = PharmacyContact.objects.all()
    serializer_class = PharmacyContactSerializer
    permission_classes = [permissions.IsAuthenticated]

class PharmacyContactCreateView(generics.CreateAPIView):
    queryset = PharmacyContact.objects.all()
    serializer_class = PharmacyContactSerializer
    permission_classes = [permissions.IsAuthenticated]

class PharmacyContactUpdateView(generics.UpdateAPIView):
    queryset = PharmacyContact.objects.all()
    serializer_class = PharmacyContactSerializer
    permission_classes = [permissions.IsAuthenticated]

class PharmacyContactDeleteView(generics.DestroyAPIView):
    queryset = PharmacyContact.objects.all()
    serializer_class = PharmacyContactSerializer
    permission_classes = [permissions.IsAuthenticated]


# Subscription management
class PharmacySubscriptionView(APIView):
    """Get or create pharmacy subscription"""
    permission_classes = [permissions.IsAuthenticated]
    
    def get(self, request):
        try:
            pharmacy = request.user.profile.pharmacy
            exchange_service = ExchangeRateService()
            exchange_snapshot = exchange_service.get_exchange_snapshot()
            exchange_rate = exchange_snapshot["rate"]
            subscription_settings = SubscriptionSystemSettings.get_solo()
            subscription, created = PharmacySubscription.objects.get_or_create(
                pharmacy=pharmacy,
                defaults={
                    'trial_start_date': timezone.now(),
                    'trial_end_date': timezone.now() + timedelta(days=subscription_settings.trial_period_days),
                    'monthly_price_usd': subscription_settings.monthly_price_usd,
                    'current_exchange_rate_bif': exchange_rate,
                    'monthly_price_bif': round(float(subscription_settings.monthly_price_usd) * float(exchange_rate), 2),
                }
            )
            latest_monthly_price_bif = round(float(subscription_settings.monthly_price_usd) * float(exchange_rate), 2)
            if (
                subscription.monthly_price_usd != subscription_settings.monthly_price_usd
                or float(subscription.current_exchange_rate_bif) != float(exchange_rate)
                or float(subscription.monthly_price_bif or 0) != float(latest_monthly_price_bif)
            ):
                subscription.monthly_price_usd = subscription_settings.monthly_price_usd
                subscription.current_exchange_rate_bif = exchange_rate
                subscription.monthly_price_bif = latest_monthly_price_bif
                subscription.save(update_fields=["monthly_price_usd", "current_exchange_rate_bif", "monthly_price_bif", "updated_at"])
            serializer = PharmacySubscriptionSerializer(subscription)
            payload = serializer.data
            payload["exchange_rate_source"] = exchange_snapshot["source_label"]
            payload["exchange_rate_source_url"] = exchange_snapshot["source_url"]
            payload["exchange_rate_updated_at"] = exchange_snapshot["updated_at"]
            payload["exchange_rate_next_update_at"] = exchange_snapshot["next_update_at"]
            payment_details = build_payment_details(subscription_settings, exchange_snapshot)
            payload["payment_details"] = payment_details
            payload["payment_details_burundi"] = payment_details
            payload["payment_details_usd"] = {
                "monthly_price_usd": payment_details["monthly_price_usd"],
                "exchange_rate": payment_details["exchange_rate"],
                "exchange_rate_source": payment_details["exchange_rate_source"],
                "exchange_rate_source_url": payment_details["exchange_rate_source_url"],
                "exchange_rate_updated_at": payment_details["exchange_rate_updated_at"],
                "payment_methods": [item for item in payment_details["payment_methods"] if item["currency"] == "USD"],
            }
            payload["upgrade_message"] = (
                "Passez au statut actif pour garder toute la visibilite de votre pharmacie."
                if subscription.subscription_status == "trial"
                else ""
            )
            payload["reward_program"] = build_pharmacy_reward_payload(pharmacy)
            return Response(payload, status=status.HTTP_200_OK)
        except Exception as e:
            return Response(
                {'error': str(e)},
                status=status.HTTP_400_BAD_REQUEST
            )


class SubscriptionPaymentListView(generics.ListCreateAPIView):
    """List or create subscription payments"""
    serializer_class = SubscriptionPaymentSerializer
    permission_classes = [permissions.IsAuthenticated]
    
    def get_queryset(self):
        if self.request.user.is_staff:
            return SubscriptionPayment.objects.select_related("pharmacy", "verified_by").all()
        pharmacy = self.request.user.profile.pharmacy
        return SubscriptionPayment.objects.filter(pharmacy=pharmacy)
    
    def perform_create(self, serializer):
        pharmacy = self.request.user.profile.pharmacy
        payment = serializer.save(pharmacy=pharmacy)

        admin_users = User.objects.filter(is_staff=True, is_active=True)
        title = "Nouveau paiement d'abonnement"
        message = (
            f"La pharmacie {pharmacy.name} a soumis un paiement {payment.currency} "
            f"de {payment.amount_bif} pour verification"
            f"{f' (ref: {payment.transaction_reference})' if payment.transaction_reference else ''}."
        )
        for admin_user in admin_users:
            create_targeted_notification(title, message, "payments:admin", recipient_user=admin_user)

        broadcast_feed_event(
            "subscription.payment.submitted",
            {
                "payment_id": payment.id,
                "pharmacy_id": pharmacy.id,
                "pharmacy_name": pharmacy.name,
                "payment_status": payment.payment_status,
                "transaction_reference": payment.transaction_reference,
                "created_at": payment.created_at.isoformat(),
            },
        )


class SubscriptionPaymentDetailView(generics.RetrieveUpdateAPIView):
    """Retrieve or update a subscription payment"""
    serializer_class = SubscriptionPaymentSerializer
    permission_classes = [permissions.IsAuthenticated]

    def get_queryset(self):
        if self.request.user.is_staff:
            return SubscriptionPayment.objects.select_related("pharmacy", "verified_by").all()

        pharmacy = getattr(self.request.user.profile, "pharmacy", None)
        if pharmacy is None:
            return SubscriptionPayment.objects.none()

        return SubscriptionPayment.objects.select_related("pharmacy", "verified_by").filter(pharmacy=pharmacy)

    def update(self, request, *args, **kwargs):
        if not request.user.is_staff:
            return Response(
                {"detail": "Seul un administrateur peut approuver ou rejeter un paiement."},
                status=status.HTTP_403_FORBIDDEN,
            )

        partial = kwargs.pop("partial", False)
        instance = self.get_object()
        previous_status = instance.payment_status

        serializer = self.get_serializer(instance, data=request.data, partial=partial)
        serializer.is_valid(raise_exception=True)
        payment = serializer.save()

        if previous_status != "verified" and payment.payment_status == "verified":
            payment.verified_at = timezone.now()
            payment.verified_by = request.user
            payment.save(update_fields=["verified_at", "verified_by"])

            pharmacy = payment.pharmacy
            settings_obj = SubscriptionSystemSettings.get_solo()
            now = timezone.now()
            subscription, _ = PharmacySubscription.objects.get_or_create(
                pharmacy=pharmacy,
                defaults={
                    "trial_start_date": now,
                    "trial_end_date": now + timedelta(days=settings_obj.trial_period_days),
                },
            )
            subscription.subscription_status = "active"
            subscription.is_trial_active = False
            subscription.trial_end_date = now
            subscription.last_payment_date = now
            subscription.next_payment_due_date = now + timedelta(days=30)
            subscription.save(
                update_fields=[
                    "subscription_status",
                    "is_trial_active",
                    "trial_end_date",
                    "last_payment_date",
                    "next_payment_due_date",
                    "updated_at",
                ]
            )
            sync_pharmacy_verification_with_subscription(pharmacy, subscription)
            safe_mark_payment_validated_for_pharmacy(
                pharmacy,
                verified_by=request.user,
                payment_reference=payment.transaction_reference,
            )

            create_targeted_notification(
                "Paiement valide",
                (
                    f"Le paiement d'abonnement de {pharmacy.name} a ete valide le "
                    f"{timezone.localtime(payment.verified_at).strftime('%Y-%m-%d %H:%M:%S')}."
                ),
                "payments:admin",
                recipient_user=request.user,
            )
            broadcast_feed_event(
                "subscription.payment.verified",
                {
                    "payment_id": payment.id,
                    "pharmacy_id": pharmacy.id,
                    "pharmacy_name": pharmacy.name,
                    "payment_status": payment.payment_status,
                    "verified_at": payment.verified_at.isoformat() if payment.verified_at else None,
                },
            )
        elif payment.payment_status != "verified":
            pharmacy = payment.pharmacy
            if not pharmacy.payments.filter(payment_status="verified").exclude(pk=payment.pk).exists():
                subscription = PharmacySubscription.objects.filter(pharmacy=pharmacy).first()
                if subscription is not None and subscription.subscription_status == "active":
                    subscription.subscription_status = "expired"
                    subscription.is_trial_active = False
                    subscription.save(update_fields=["subscription_status", "is_trial_active", "updated_at"])
                sync_pharmacy_verification_with_subscription(pharmacy, subscription)

        return Response(self.get_serializer(payment).data, status=status.HTTP_200_OK)


class SubscriptionPaymentProofView(APIView):
    permission_classes = [permissions.IsAuthenticated]

    def get(self, request, pk: int):
        payment = SubscriptionPayment.objects.select_related("pharmacy").filter(pk=pk).first()
        if payment is None or not payment.proof_image:
            raise Http404("Preuve de paiement introuvable.")

        actor_profile = getattr(request.user, "profile", None)
        actor_pharmacy_id = getattr(actor_profile, "pharmacy_id", None)
        can_access = bool(
            getattr(request.user, "is_staff", False)
            or (actor_profile is not None and actor_pharmacy_id == payment.pharmacy_id)
        )
        if not can_access:
            raise Http404("Preuve de paiement introuvable.")

        proof_field = payment.proof_image
        storage = proof_field.storage
        if not proof_field.name or not storage.exists(proof_field.name):
            raise Http404("Preuve de paiement introuvable.")

        content_type, _ = mimetypes.guess_type(proof_field.name)
        proof_file = storage.open(proof_field.name, "rb")
        response = FileResponse(proof_file, content_type=content_type or "application/octet-stream")
        response["Cache-Control"] = "private, no-store, max-age=0, must-revalidate"
        response["Pragma"] = "no-cache"
        response["Content-Disposition"] = f'inline; filename="{Path(proof_field.name).name}"'
        return response
