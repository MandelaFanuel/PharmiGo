from django.urls import path
from rest_framework import generics

from .models import ChatMessage
from .serializers import ChatMessageSerializer


class ChatMessageListView(generics.ListCreateAPIView):
    queryset = ChatMessage.objects.select_related("pharmacy").all()
    serializer_class = ChatMessageSerializer


urlpatterns = [
    path("messages/", ChatMessageListView.as_view(), name="chat-messages"),
]
