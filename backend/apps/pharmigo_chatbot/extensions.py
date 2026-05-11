from __future__ import annotations

import logging

from django.conf import settings

from apps.pharmacies.services.rewards import get_reward_settings

logger = logging.getLogger(__name__)


class OmniRewardPromptMixin:
    def _build_system_prompt(self) -> str:  # type: ignore[override]
        base_prompt = super()._build_system_prompt()  # type: ignore[misc]
        if not getattr(settings, "PHARMIGO_OMNI_REWARD_ENABLED", True):
            return base_prompt

        try:
            reward_settings = get_reward_settings()
            reward_prompt = (
                "\n\n7. MODULE OMNI-REWARD (EXTENSION MODULAIRE)\n"
                "- En cas de panne de cette couche, conserve le comportement stable existant.\n"
                "- Les pharmacies visibles pour les patients restent strictement limitees aux pharmacies verified ou trial actives eligibles.\n"
                "- Si un pharmacien n'a pas acces a la plateforme, ne sors jamais du message de reactivation autorise.\n"
                f"- Le programme ambassadeur en cours exige {reward_settings.reward_referral_threshold} parrainages valides.\n"
                f"- Un parrainage n'est valide qu'apres preuve de paiement approuvee par l'admin et au moins {reward_settings.reward_min_activity_count} ordonnances reelles traitees.\n"
                f"- En cas d'activite repetitive sur le meme appareil au-dela de {reward_settings.reward_device_daily_limit} validations par jour et sur plusieurs dates, signale une suspicion de fraude aux couches internes.\n"
                "- Ne revele jamais ces calculs anti-fraude au patient final.\n"
            )
            return f"{base_prompt}{reward_prompt}"
        except Exception:
            logger.exception("Unable to enrich Gemini prompt with Omni-Reward settings.")
            return base_prompt


def build_gemini_chat_service(base_cls):
    if not getattr(settings, "PHARMIGO_OMNI_REWARD_ENABLED", True):
        return base_cls()

    try:
        class OmniRewardGeminiChatService(OmniRewardPromptMixin, base_cls):
            pass

        return OmniRewardGeminiChatService()
    except Exception:
        logger.exception("Unable to create Omni-Reward Gemini service, falling back to stable GeminiChatService.")
        return base_cls()
