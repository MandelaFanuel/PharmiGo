from rest_framework import generics

from .models import Notification
from .serializers import NotificationSerializer


class NotificationListView(generics.ListCreateAPIView):
    queryset = Notification.objects.all()
    serializer_class = NotificationSerializer
