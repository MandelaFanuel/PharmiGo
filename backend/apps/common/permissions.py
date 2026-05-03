from rest_framework.permissions import BasePermission

class IsPharmacyOwner(BasePermission):
    """
    Custom permission to only allow pharmacy owners to edit their own prescriptions.
    """
    def has_object_permission(self, request, view, obj):
        return obj.pharmacy.owner == request.user

class IsAuthenticated(BasePermission):
    """
    Custom permission to only allow authenticated users to access certain views.
    """
    def has_permission(self, request, view):
        return request.user and request.user.is_authenticated

class IsAdminUser(BasePermission):
    """
    Custom permission to only allow admin users to access certain views.
    """
    def has_permission(self, request, view):
        return request.user and request.user.is_staff