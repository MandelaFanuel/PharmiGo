from django.contrib.auth import get_user_model
from rest_framework import generics, permissions, status
from rest_framework.views import APIView
from rest_framework.response import Response
from django.utils import timezone
from datetime import timedelta
from .models import Pharmacy, PharmacyContact, PharmacySubscription, SubscriptionPayment, SubscriptionSystemSettings
from .serializers import PharmacySerializer, PharmacyContactSerializer, PharmacySubscriptionSerializer, SubscriptionPaymentSerializer
from .payment_config import build_payment_details
from .services.exchange_rate_service import ExchangeRateService
from pharmigo.api import broadcast_feed_event, create_targeted_notification

User = get_user_model()

# Pharmacy CRUD
class PharmacyListView(generics.ListCreateAPIView):
    queryset = Pharmacy.objects.all()
    serializer_class = PharmacySerializer

class PharmacyDetailView(generics.RetrieveAPIView):
    queryset = Pharmacy.objects.all()
    serializer_class = PharmacySerializer

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
            subscription_settings = SubscriptionSystemSettings.get_solo()
            subscription, created = PharmacySubscription.objects.get_or_create(
                pharmacy=pharmacy,
                defaults={
                    'trial_start_date': timezone.now(),
                    'trial_end_date': timezone.now() + timedelta(days=subscription_settings.trial_period_days),
                    'monthly_price_usd': subscription_settings.monthly_price_usd,
                    'current_exchange_rate_bif': exchange_service.get_exchange_rate(),
                    'monthly_price_bif': exchange_service.convert_usd_to_bif(float(subscription_settings.monthly_price_usd)),
                }
            )
            if subscription.monthly_price_usd != subscription_settings.monthly_price_usd:
                subscription.monthly_price_usd = subscription_settings.monthly_price_usd
                subscription.current_exchange_rate_bif = exchange_service.get_exchange_rate()
                subscription.monthly_price_bif = exchange_service.convert_usd_to_bif(float(subscription_settings.monthly_price_usd))
                subscription.save(update_fields=["monthly_price_usd", "current_exchange_rate_bif", "monthly_price_bif", "updated_at"])
            serializer = PharmacySubscriptionSerializer(subscription)
            payload = serializer.data
            payment_details = build_payment_details(subscription_settings, exchange_service.get_exchange_rate())
            payload["payment_details"] = payment_details
            payload["payment_details_burundi"] = payment_details
            payload["payment_details_usd"] = {
                "monthly_price_usd": payment_details["monthly_price_usd"],
                "payment_methods": [item for item in payment_details["payment_methods"] if item["currency"] == "USD"],
            }
            payload["upgrade_message"] = (
                "Passez au statut actif pour garder toute la visibilite de votre pharmacie."
                if subscription.subscription_status == "trial"
                else ""
            )
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
            if not pharmacy.is_verified:
                pharmacy.is_verified = True
                pharmacy.save(update_fields=["is_verified"])

            subscription, _ = PharmacySubscription.objects.get_or_create(
                pharmacy=pharmacy,
                defaults={
                    "trial_start_date": timezone.now(),
                    "trial_end_date": timezone.now() + timedelta(days=30),
                },
            )
            subscription.subscription_status = "active"
            subscription.is_trial_active = False
            subscription.last_payment_date = timezone.now()
            subscription.next_payment_due_date = timezone.now() + timedelta(days=30)
            subscription.save(
                update_fields=[
                    "subscription_status",
                    "is_trial_active",
                    "last_payment_date",
                    "next_payment_due_date",
                    "updated_at",
                ]
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
        elif payment.payment_status != "verified" and payment.pharmacy.is_verified:
            pharmacy = payment.pharmacy
            if not pharmacy.payments.filter(payment_status="verified").exclude(pk=payment.pk).exists():
                pharmacy.is_verified = False
                pharmacy.save(update_fields=["is_verified"])

        return Response(self.get_serializer(payment).data, status=status.HTTP_200_OK)
