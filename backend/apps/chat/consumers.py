import json
from channels.generic.websocket import AsyncWebsocketConsumer
from channels.db import database_sync_to_async

# Lazy imports moved inside methods to avoid AppRegistryNotReady



class ChatConsumer(AsyncWebsocketConsumer):
    async def connect(self):
        try:
            self.room_name = self.scope["url_route"]["kwargs"]["room_name"]
            self.room_group_name = f"chat_{self.room_name}"
            self.presence_profile = await self.resolve_presence_profile()

            if self.room_name == "public-feed":
                await self.channel_layer.group_add(self.room_group_name, self.channel_name)
                await self.accept()
                try:
                    await self.mark_presence_connected()
                except Exception:
                    pass
                return

            # room_name format expected: "contact_{contact_id}"
            if not self.room_name.startswith("contact_"):
                await self.close()
                return

            try:
                contact_id = int(self.room_name.split("_")[1])
            except (IndexError, ValueError):
                await self.close()
                return

            # Verify user is part of this contact
            user = self.scope.get("user")
            if user is None or not user.is_authenticated:
                await self.close()
                return

            # Get pharmacy associated with user
            self.pharmacy = await self.get_user_pharmacy(user)
            if self.pharmacy is None:
                await self.close()
                return

            # Verify contact exists and involves this pharmacy
            self.contact = await self.get_contact(contact_id, self.pharmacy)
            if self.contact is None:
                await self.close()
                return
            await self.channel_layer.group_add(
                self.room_group_name,
                self.channel_name
            )
            await self.accept()
            try:
                await self.mark_presence_connected()
            except Exception:
                pass
        except Exception:
            await self.close()

    async def disconnect(self, close_code):
        try:
            await self.mark_presence_disconnected()
        except Exception:
            pass
        if hasattr(self, 'room_group_name'):
            await self.channel_layer.group_discard(
                self.room_group_name,
                self.channel_name
            )

    async def receive(self, text_data):
        try:
            data = json.loads(text_data)
        except json.JSONDecodeError:
            return

        message = data.get("message", "").strip()
        if not message:
            return

        # Determine sender and recipient
        sender_pharmacy = self.pharmacy
        # The other pharmacy in the contact
        if self.contact.pharmacy == sender_pharmacy:
            recipient_pharmacy = self.contact.contact_pharmacy
        else:
            recipient_pharmacy = self.contact.pharmacy

        # Save message to database
        chat_message = await self.save_message(
            sender_pharmacy=sender_pharmacy,
            recipient_pharmacy=recipient_pharmacy,
            message=message
        )

        # Broadcast to group
        await self.channel_layer.group_send(
            self.room_group_name,
            {
                "type": "chat_message",
                "message": message,
                "sender_pharmacy_id": sender_pharmacy.id,
                "sender_pharmacy_name": sender_pharmacy.name,
                "recipient_pharmacy_id": recipient_pharmacy.id,
                "message_id": chat_message.id,
                "created_at": chat_message.created_at.isoformat(),
            }
        )

    async def chat_message(self, event):
        await self.send(text_data=json.dumps({
            "type": "chat.message",
            "message": event["message"],
            "sender_pharmacy_id": event["sender_pharmacy_id"],
            "sender_pharmacy_name": event["sender_pharmacy_name"],
            "recipient_pharmacy_id": event["recipient_pharmacy_id"],
            "message_id": event["message_id"],
            "created_at": event["created_at"],
        }))

    async def feed_event(self, event):
        await self.send(text_data=json.dumps({
            "type": "feed.event",
            "event_type": event.get("event_type"),
            "payload": event.get("payload"),
        }))

    @database_sync_to_async
    def get_user_pharmacy(self, user):
        profile = getattr(user, "profile", None)
        if profile is None:
            return None
        return getattr(profile, "pharmacy", None)

    @database_sync_to_async
    def get_contact(self, contact_id, pharmacy):
        from apps.pharmacies.models import PharmacyContact
        try:
            return PharmacyContact.objects.select_related("pharmacy", "contact_pharmacy").get(
                id=contact_id,
                pharmacy=pharmacy
            )
        except PharmacyContact.DoesNotExist:
            try:
                return PharmacyContact.objects.select_related("pharmacy", "contact_pharmacy").get(
                    id=contact_id,
                    contact_pharmacy=pharmacy
                )
            except PharmacyContact.DoesNotExist:
                return None

    @database_sync_to_async
    def save_message(self, sender_pharmacy, recipient_pharmacy, message):
        from .models import ChatMessage
        return ChatMessage.objects.create(
            pharmacy=recipient_pharmacy,
            sender_pharmacy=sender_pharmacy,
            sender_name=sender_pharmacy.name,
            sender_role="pharmacy",
            message=message,
        )

    async def mark_presence_connected(self):
        if self.presence_profile is None:
            return

        payload = await self.set_profile_online(self.presence_profile.pk)
        await self.channel_layer.group_send(
            "chat_public-feed",
            {
                "type": "feed.event",
                "event_type": "presence.updated",
                "payload": payload,
            },
        )

    async def mark_presence_disconnected(self):
        if self.presence_profile is None:
            return

        payload = await self.set_profile_offline(self.presence_profile.pk)
        await self.channel_layer.group_send(
            "chat_public-feed",
            {
                "type": "feed.event",
                "event_type": "presence.updated",
                "payload": payload,
            },
        )

    async def resolve_presence_profile(self):
        user = self.scope.get("user")
        if user is not None and getattr(user, "is_authenticated", False):
            return await self.get_profile_for_user_id(user.pk)
        return None

    @database_sync_to_async
    def get_profile_for_user_id(self, user_id):
        from apps.users.models import UserProfile

        try:
            return UserProfile.objects.select_related("pharmacy", "user").get(user_id=user_id)
        except UserProfile.DoesNotExist:
            return None

    @database_sync_to_async
    def set_profile_online(self, profile_id):
        from apps.users.models import UserProfile

        profile = UserProfile.objects.select_related("pharmacy", "user").get(pk=profile_id)
        profile.mark_online()
        return {
            "user_id": profile.user_id,
            "role": profile.role,
            "is_online": profile.is_considered_online(),
            "last_seen": profile.last_seen.isoformat() if profile.last_seen else None,
            "pharmacy_id": profile.pharmacy_id,
        }

    @database_sync_to_async
    def set_profile_offline(self, profile_id):
        from apps.users.models import UserProfile

        profile = UserProfile.objects.select_related("pharmacy", "user").get(pk=profile_id)
        profile.mark_offline()
        return {
            "user_id": profile.user_id,
            "role": profile.role,
            "is_online": profile.is_considered_online(),
            "last_seen": profile.last_seen.isoformat() if profile.last_seen else None,
            "pharmacy_id": profile.pharmacy_id,
        }
