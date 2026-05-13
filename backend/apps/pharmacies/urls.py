from django.urls import path

from .views import (
    PharmacyDetailView,
    PharmacyListView,
    PharmacyProfileImageView,
    PharmacyContactListView,
    PharmacyContactDetailView,
    PharmacyContactCreateView,
    PharmacyContactUpdateView,
    PharmacyContactDeleteView,
    PharmacySubscriptionView,
    SubscriptionPaymentListView,
    SubscriptionPaymentDetailView,
    SubscriptionPaymentProofView,
)

urlpatterns = [
    path("", PharmacyListView.as_view(), name="pharmacy-list"),
    path("<int:pk>/", PharmacyDetailView.as_view(), name="pharmacy-detail"),
    path("<int:pk>/profile-image/", PharmacyProfileImageView.as_view(), name="pharmacy-profile-image"),
    path("contacts/", PharmacyContactListView.as_view(), name="pharmacy-contact-list"),
    path("contacts/<int:pk>/", PharmacyContactDetailView.as_view(), name="pharmacy-contact-detail"),
    path("contacts/create/", PharmacyContactCreateView.as_view(), name="pharmacy-contact-create"),
    path("contacts/<int:pk>/update/", PharmacyContactUpdateView.as_view(), name="pharmacy-contact-update"),
    path("contacts/<int:pk>/delete/", PharmacyContactDeleteView.as_view(), name="pharmacy-contact-delete"),
    path("subscription/", PharmacySubscriptionView.as_view(), name="pharmacy-subscription"),
    path("payments/", SubscriptionPaymentListView.as_view(), name="subscription-payment-list"),
    path("payments/<int:pk>/", SubscriptionPaymentDetailView.as_view(), name="subscription-payment-detail"),
    path("payments/<int:pk>/proof/", SubscriptionPaymentProofView.as_view(), name="subscription-payment-proof"),
]
