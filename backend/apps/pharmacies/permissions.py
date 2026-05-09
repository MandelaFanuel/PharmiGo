"""Permissions for pharmacy subscription"""

from rest_framework import permissions
from apps.pharmacies.services.access import pharmacy_has_platform_access


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
            return pharmacy_has_platform_access(pharmacy)
        except AttributeError:
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
            return pharmacy_has_platform_access(pharmacy)
        except AttributeError:
            return False
