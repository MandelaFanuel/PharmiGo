from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from typing import Any, Dict, List

from django.utils import timezone

from apps.pharmacies.services.access import is_pharmacy_partner_eligible
from apps.pharmacies.models import Pharmacy
from .utils import normalize_text


@dataclass(frozen=True)
class PharmiGoIdentityRecord:
    creator_name: str = "Mandela Fanuel"
    inspiration_name: str = "Fundiko Rebecca Deborah"
    conception_date: str = "07 Mars 2026"
    conception_story: str = (
        "Suite a une recherche desesperee de DISOWAX pour sa femme Fundiko Rebecca Deborah "
        "a Kamenge, Kinama et Kigobe."
    )
    development_started: str = "20 Avril 2026"
    development_completed: str = "20 Mai 2026"
    development_place: str = "RundiNova, Gitega"


class IdentityService:
    """Static identity memory for PharmiGo's origin and special user affinity."""

    SPECIAL_USERS = {
        "mandela fanuel": "founder",
        "fundiko rebecca deborah": "inspiration",
    }

    @classmethod
    def get_identity_record(cls) -> PharmiGoIdentityRecord:
        return PharmiGoIdentityRecord()

    @classmethod
    def resolve_special_user_kind(cls, context: Dict[str, Any]) -> str:
        candidates: List[str] = [
            str(context.get("display_name") or ""),
            str(context.get("username") or ""),
            str(context.get("email") or ""),
        ]
        for candidate in candidates:
            normalized = normalize_text(candidate)
            for special_name, special_kind in cls.SPECIAL_USERS.items():
                if special_name in normalized:
                    return special_kind
        return ""

    @classmethod
    def build_identity_context(cls, context: Dict[str, Any]) -> Dict[str, Any]:
        record = cls.get_identity_record()
        special_kind = cls.resolve_special_user_kind(context)
        return {
            "creator_name": record.creator_name,
            "inspiration_name": record.inspiration_name,
            "conception_date": record.conception_date,
            "conception_story": record.conception_story,
            "development_started": record.development_started,
            "development_completed": record.development_completed,
            "development_place": record.development_place,
            "special_user_kind": special_kind,
            "tone_hint": "respectful_affectionate" if special_kind else "warm_human",
        }

    @classmethod
    def looks_like_origin_question(cls, question: str) -> bool:
        normalized = normalize_text(question or "")
        markers = [
            "qui ta cree",
            "qui t'a cree",
            "qui est ton createur",
            "comment pharmigo est ne",
            "comment pharmigo est ne",
            "origine de pharmigo",
            "histoire de pharmigo",
            "mandela fanuel",
            "fundiko rebecca deborah",
            "rundinova",
        ]
        return any(marker in normalized for marker in markers)

    @classmethod
    def build_origin_answer(cls, context: Dict[str, Any]) -> str:
        record = cls.get_identity_record()
        display_name = (context.get("display_name") or "").strip()
        special_kind = cls.resolve_special_user_kind(context)
        opener = f"{display_name}, " if display_name else ""
        special_note = ""
        if special_kind == "founder":
            special_note = "Mandela, je me souviens avec respect que vous etes a l'origine de cette aventure PharmiGo. ❤️ "
        elif special_kind == "inspiration":
            special_note = "Rebecca, votre histoire fait partie du coeur meme de PharmiGo. ❤️ "

        return (
            f"{opener}{special_note}PharmiGo est ne d'un besoin reel et humain. "
            f"Son createur est {record.creator_name}. L'idee a ete concue le {record.conception_date}, "
            f"{record.conception_story} Le developpement a officiellement commence le {record.development_started} "
            f"chez {record.development_place}, puis une application Beta prete pour les testes a ete finalisee le {record.development_completed}. "
            "Autrement dit, PharmiGo n'est pas qu'une plateforme: c'est une reponse a la fatigue, a l'urgence et a l'espoir. 😊"
        )


class PrivacyGuard:
    """Role-aware privacy helper for chatbot account and data access prompts."""

    @staticmethod
    def looks_like_account_information_request(question: str) -> bool:
        normalized = normalize_text(question or "")
        markers = [
            "quelles sont mes informations",
            "mes informations",
            "mes donnees",
            "mes données",
            "mon compte",
            "mes parametres de securite",
            "mes parametres",
            "mes commandes",
        ]
        return any(marker in normalized for marker in markers)

    @staticmethod
    def build_account_information_answer(context: Dict[str, Any]) -> str:
        if not context.get("is_authenticated"):
            return (
                "Je peux vous aider avec vos informations de compte, mais j'ai besoin que vous soyez connecte(e) "
                "pour proteger votre confidentialite. Une fois connecte(e), dites-moi simplement ce que vous voulez consulter."
            )
        display_name = (context.get("display_name") or "").strip()
        prefix = f"{display_name}, " if display_name else ""
        return (
            f"{prefix}je peux vous montrer vos donnees personnelles, vos dernieres commandes ou vos parametres de securite. "
            "Que souhaitez-vous consulter precisement ?"
        )


class WholesaleService:
    """Public-facing wholesale discovery constrained to eligible partner pharmacies."""

    @staticmethod
    def looks_like_wholesale_directory_request(question: str) -> bool:
        normalized = normalize_text(question or "")
        wholesale_markers = ["en gros", "vente en gros", "grossiste", "grossistes", "pharmacies de gros", "vendant en gros"]
        directory_markers = ["pharmacie", "pharmacies", "qui vend", "qui vendent", "liste", "donne moi", "présente", "presente", "montre"]
        return any(marker in normalized for marker in wholesale_markers) and any(marker in normalized for marker in directory_markers)

    @staticmethod
    def build_wholesale_directory_answer(context: Dict[str, Any]) -> str:
        pharmacies = list(
            Pharmacy.objects.filter(is_active=True, wholesale_supported=True)
            .order_by("name")
        )
        visible = [pharmacy for pharmacy in pharmacies if is_pharmacy_partner_eligible(pharmacy)]
        if not visible:
            return (
                "Je n'ai pas encore de grossiste PharmiGo eligible a vous proposer pour le moment. "
                "Des qu'un partenaire grossiste actif est disponible, je pourrai vous communiquer ses coordonnees professionnelles."
            )

        lines = []
        for pharmacy in visible[:10]:
            mode_label = "gros et detail" if pharmacy.retail_supported else "gros uniquement"
            lines.append(
                f"- {pharmacy.name} • {pharmacy.phone_number} • {pharmacy.city} • {mode_label}"
            )

        display_name = (context.get("display_name") or "").strip()
        prefix = f"{display_name}, " if display_name else ""
        return (
            f"{prefix}voici les pharmacies PharmiGo qui vendent actuellement en gros et qui sont eligibles sur la plateforme:\n"
            + "\n".join(lines)
            + "\n\nJe ne partage ici que leurs informations professionnelles publiques pour respecter la confidentialite du reseau."
        )


def describe_time_since(joined_at) -> str:
    if not joined_at:
        return ""
    now = timezone.now()
    delta = now - joined_at
    days = max(delta.days, 0)
    if days < 31:
        return f"environ {days} jour(s)"
    months = max(days // 30, 1)
    return f"environ {months} mois"


def build_report_pre_start_answer(*, joined_at: datetime, display_name: str) -> str:
    joined_label = timezone.localtime(joined_at).strftime("%d/%m/%Y")
    age_label = describe_time_since(joined_at)
    prefix = f"{display_name}, " if display_name else ""
    return (
        f"{prefix}je ne peux pas generer de rapport pour cette periode car votre aventure avec PharmiGo n'avait pas encore commence ! ✨ "
        f"Vous nous avez rejoint le {joined_label}, il y a {age_label}. "
        "Souhaitez-vous un rapport depuis votre premier jour d'activite pour une precision maximale ?"
    )
