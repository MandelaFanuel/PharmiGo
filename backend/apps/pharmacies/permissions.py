"""Permissions for pharmacy subscription"""

from rest_framework import permissions
from apps.pharmacies.models import PharmacySubscription


class IsPharmacySubscriptionActive(permissions.BasePermission):
    """
    Permission to check if pharmacy has an active subscription
    """
    
    def has_permission(self, request, view):
        if not request.user or not request.user.is_authenticated:
            return False
        
        # Check if user is a pharmacy
        if not hasattr(request.user, 'profile') or request.user.profile.role != 'pharmacy':
            return False
        
        # Get pharmacy subscription
        try:
            pharmacy = request.user.profile.pharmacy
            subscription = PharmacySubscription.objects.get(pharmacy=pharmacy)
            return subscription.is_active()
        except (PharmacySubscription.DoesNotExist, AttributeError):
            return False


class IsPharmacySubscriptionActiveOrTrial(permissions.BasePermission):
    """
    Permission to check if pharmacy has active subscription OR active trial
    """
    
    def has_permission(self, request, view):
        if not request.user or not request.user.is_authenticated:
            return False
        
        # Check if user is a pharmacy
        if not hasattr(request.user, 'profile') or request.user.profile.role != 'pharmacy':
            return False
        
        # Get pharmacy subscription
        try:
            pharmacy = request.user.profile.pharmacy
            subscription = PharmacySubscription.objects.get(pharmacy=pharmacy)
            
            # Allow if subscription is active
            if subscription.subscription_status == 'active':
                return True
            
            # Allow if trial is still active
            if subscription.subscription_status == 'trial' and subscription.is_trial_active:
                from django.utils import timezone
                return timezone.now() <= subscription.trial_end_date
            
            return False
        except (PharmacySubscription.DoesNotExist, AttributeError):
            return False
