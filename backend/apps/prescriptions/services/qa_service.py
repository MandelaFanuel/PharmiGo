"""Q&A Service for ChatBot to answer questions based on database data"""

import re
from collections import defaultdict
from difflib import get_close_matches

from django.db.models import Count, Q

from apps.prescriptions.models import PharmacyStock, Prescription
from apps.pharmacies.models import Pharmacy


class QAService:
    """Service to answer questions based on PharmiGo database data"""

    MEDICATION_ALIASES = {
        "paracetamol": ["paracetamol", "paracétamol", "doliprane", "efferalgan", "dafalgan"],
        "amoxicilline": ["amoxicilline", "amoxicillin", "augmentin"],
        "ibuprofene": ["ibuprofene", "ibuprofène", "ibuprofen", "advil", "nurofen"],
        "metformine": ["metformine", "metformin", "glucophage"],
        "omeprazole": ["omeprazole", "oméprazole", "mopral"],
        "cetirizine": ["cetirizine", "cétirizine", "zyrtec"],
    }

    def __init__(self):
        self.all_medication_aliases = {
            alias: canonical
            for canonical, aliases in self.MEDICATION_ALIASES.items()
            for alias in aliases
        }
    
    def answer_question(self, question: str, user=None) -> str:
        """
        Answer a user's question based on database data.
        
        Args:
            question: The user's question in natural language
            user: The authenticated user (optional)
            
        Returns:
            A response string with the answer
        """
        question_lower = question.lower()

        if self._is_non_medical_conversation(question_lower):
            return self._get_default_response()

        if self._is_about_usage(question_lower):
            return self._get_usage_response()

        medication_answer = self._answer_exact_medication_question(question_lower, user)
        if medication_answer is not None:
            return medication_answer
        
        # Questions about pharmacies
        if self._is_about_pharmacies(question_lower):
            return self._answer_pharmacy_question(question_lower, user)
        
        # Questions about prescriptions
        elif self._is_about_prescriptions(question_lower):
            return self._answer_prescription_question(question_lower, user)
        
        # Questions about medications/stock
        elif self._is_about_medications(question_lower):
            return self._answer_medication_question(question_lower, user)
        
        # Questions about the user's account
        elif self._is_about_account(question_lower):
            return self._answer_account_question(question_lower, user)
        
        # Default response
        else:
            return self._get_default_response()
    
    def _is_about_pharmacies(self, question: str) -> bool:
        pharmacy_keywords = ['pharmacie', 'pharmacies', 'pharmacy', 'drugstore', 'médicament', 'medicament']
        return any(keyword in question for keyword in pharmacy_keywords)
    
    def _is_about_prescriptions(self, question: str) -> bool:
        prescription_keywords = ['ordonnance', 'ordonnances', 'prescription', 'prescriptions', 'medicament']
        return any(keyword in question for keyword in prescription_keywords)
    
    def _is_about_medications(self, question: str) -> bool:
        medication_keywords = ['stock', 'disponible', 'médicament', 'medicament', 'quantité', 'trouver', 'acheter']
        if any(keyword in question for keyword in medication_keywords):
            return True
        return any(alias in question for alias in self.all_medication_aliases)
    
    def _is_about_account(self, question: str) -> bool:
        account_keywords = ['mon compte', 'mon profil', 'mes informations', 'mon historique']
        return any(keyword in question for keyword in account_keywords)

    def _is_about_usage(self, question: str) -> bool:
        usage_keywords = [
            "comment utiliser",
            "comment ça marche",
            "comment ca marche",
            "utiliser la plateforme",
            "publier une ordonnance",
            "analyser une ordonnance",
        ]
        return any(keyword in question for keyword in usage_keywords)

    def _is_non_medical_conversation(self, question: str) -> bool:
        conversation_markers = [
            "bonjour",
            "salut",
            "bonsoir",
            "coucou",
            "hello",
            "hi",
            "merci",
            "je t'aime",
            "je t aime",
            "je vous aime",
            "prive",
            "privé",
            "confidentiel",
            "confidentielle",
            "me connecter",
            "connexion",
            "se connecter",
            "mon cas",
            "ma situation",
            "au revoir",
            "bye",
            "goodbye",
        ]
        return any(marker in question for marker in conversation_markers)

    def _extract_requested_medications(self, question: str):
        found = []
        normalized_question = re.sub(r"[^\w\sàâäéèêëîïôöùûüçµ-]", " ", question.lower())
        tokens = [token.strip() for token in normalized_question.split() if token.strip()]

        if self._is_non_medical_conversation(normalized_question):
            return found

        if self._is_about_usage(normalized_question) and not self._looks_like_medication_request(normalized_question):
            return found

        for alias, canonical in self.all_medication_aliases.items():
            if alias in normalized_question and canonical not in found:
                found.append(canonical)

        if found:
            return found

        stock_names = PharmacyStock.objects.values_list("medication_name", flat=True).distinct()
        for stock_name in stock_names:
            normalized = stock_name.lower()
            if normalized and any(normalized in token or token in normalized for token in tokens if len(token) > 4):
                if normalized not in found:
                    found.append(normalized)

        if found:
            return found

        known_terms = list(self.all_medication_aliases.keys()) + [name.lower() for name in stock_names if name]
        for token in tokens:
            if len(token) < 4:
                continue
            close_matches = get_close_matches(token, known_terms, n=3, cutoff=0.72)
            for match in close_matches:
                canonical = self.all_medication_aliases.get(match, match)
                if canonical not in found:
                    found.append(canonical)
        return found

    def _extract_dosage(self, question: str):
        match = re.search(r"(\d+\s?(?:mg|g|ml|mcg|µg|ui|%))", question, re.I)
        return match.group(1).replace(" ", "") if match else None

    def _answer_exact_medication_question(self, question: str, user=None):
        medications = self._extract_requested_medications(question)
        if not medications:
            if self._looks_like_medication_request(question):
                raw_name = self._extract_raw_medication_fragment(question)
                if raw_name:
                    return f"Desole, ce medicament {raw_name} n'est dans aucune des pharmacies de PharmiGo."
                return "Je n'ai pas trouve ce medicament dans ma base de donnees actuelle. Essayez avec un autre nom de medicament, un dosage, ou publiez une ordonnance pour une analyse complete."
            return None

        dosage = self._extract_dosage(question)
        matching_stock = PharmacyStock.objects.select_related("pharmacy").filter(is_available=True, quantity__gt=0)

        pharmacy_matches = defaultdict(lambda: {"pharmacy": None, "medications": []})
        alternative_matches = defaultdict(lambda: {"pharmacy": None, "medications": []})
        exact_match_found = False
        stock_found_for_request = False

        for medication in medications:
            aliases = self.MEDICATION_ALIASES.get(medication, [medication])
            query = Q()
            for alias in aliases:
                query |= Q(medication_name__icontains=alias) | Q(generic_name__icontains=alias)

            medication_stocks = matching_stock.filter(query)
            if not medication_stocks.exists():
                continue

            stock_found_for_request = True
            exact_stocks = medication_stocks
            if dosage:
                exact_stocks = medication_stocks.filter(Q(dosage__icontains=dosage) | Q(dosage__isnull=True) | Q(dosage=""))

            if exact_stocks.exists():
                exact_match_found = True
                selected_stocks = exact_stocks
            else:
                selected_stocks = medication_stocks

            for stock in selected_stocks:
                pharmacy_matches[stock.pharmacy_id]["pharmacy"] = stock.pharmacy
                pharmacy_matches[stock.pharmacy_id]["medications"].append(stock)
                alternative_matches[stock.pharmacy_id]["pharmacy"] = stock.pharmacy
                alternative_matches[stock.pharmacy_id]["medications"].append(stock)

        pharmacies_with_all = []
        for match in pharmacy_matches.values():
            unique_names = {
                (stock.generic_name or stock.medication_name or "").lower()
                for stock in match["medications"]
            }
            if len(unique_names) >= len(medications):
                pharmacies_with_all.append(match["pharmacy"])

        if pharmacies_with_all and exact_match_found:
            return self._format_exact_stock_response(pharmacies_with_all, "Les médicaments demandés sont disponibles")

        if pharmacies_with_all and dosage and not exact_match_found:
            return self._format_alternative_stock_response(pharmacies_with_all, dosage)

        if stock_found_for_request:
            fallback_pharmacies = []
            for match in alternative_matches.values():
                if match["pharmacy"] is not None:
                    fallback_pharmacies.append(match["pharmacy"])
            if fallback_pharmacies:
                if dosage and not exact_match_found:
                    return self._format_alternative_stock_response(fallback_pharmacies, dosage)
                return self._format_exact_stock_response(fallback_pharmacies, "J'ai trouvé les médicaments suivants dans les stocks enregistrés")

        if not pharmacies_with_all:
            requested = ", ".join(medications)
            dosage_text = f" en dosage {dosage}" if dosage else ""
            return f"Je n'ai pas encore trouvé de pharmacie avec {requested}{dosage_text} dans les stocks enregistrés en temps réel."

    def _looks_like_medication_request(self, question: str) -> bool:
        if self._is_about_usage(question):
            usage_only_markers = [
                "bonjour",
                "salut",
                "bonsoir",
                "qui es tu",
                "qui es-tu",
                "que fais tu",
                "que fais-tu",
                "que peux tu faire",
                "que peux-tu faire",
                "comment utiliser",
                "comment ça marche",
                "comment ca marche",
            ]
            if any(marker in question for marker in usage_only_markers):
                return False

        health_only_markers = [
            "je me sens mal",
            "je ne me sens pas bien",
            "pas bien",
            "je suis malade",
            "je suis souffr",
            "je suis soufr",
            "souffr",
            "fatigue",
            "faible",
            "douleur",
            "fievre",
            "fièvre",
            "toux",
            "vomissement",
            "angoisse",
        ]
        if any(marker in question for marker in health_only_markers):
            return False

        request_markers = [
            "où",
            "ou",
            "trouver",
            "acheter",
            "cherche",
            "recherche",
            "disponible",
        ]
        return any(marker in question for marker in request_markers)

    def _extract_raw_medication_fragment(self, question: str) -> str:
        normalized = re.sub(r"[^\w\sàâäéèêëîïôöùûüçµ-]", " ", question.lower())
        tokens = [token.strip() for token in normalized.split() if token.strip()]
        ignored = {
            "dans", "quelle", "pharmacie", "trouver", "acheter", "medicament", "médicament",
            "je", "peux", "puis", "alors", "avec", "pour", "des", "les", "une", "mon", "mes",
            "ou", "où", "cherche", "recherche", "disponible",
        }
        meaningful = [token for token in tokens if token not in ignored]
        return " ".join(meaningful[:3]).strip()

    def _format_exact_stock_response(self, pharmacies, intro: str) -> str:
        unique_pharmacies = list(dict.fromkeys([pharmacy for pharmacy in pharmacies if pharmacy is not None]))[:5]
        names = " et ".join(pharmacy.name for pharmacy in unique_pharmacies[:2]) if len(unique_pharmacies) <= 2 else ", ".join(pharmacy.name for pharmacy in unique_pharmacies)
        addresses = " ".join(f"{pharmacy.name} : {pharmacy.address}." for pharmacy in unique_pharmacies)
        return f"{intro} dans les pharmacies {names}. Voici leurs adresses exactes : {addresses}"

    def _format_alternative_stock_response(self, pharmacies, requested_dosage: str) -> str:
        unique_pharmacies = list(dict.fromkeys([pharmacy for pharmacy in pharmacies if pharmacy is not None]))[:5]
        names = " et ".join(pharmacy.name for pharmacy in unique_pharmacies[:2]) if len(unique_pharmacies) <= 2 else ", ".join(pharmacy.name for pharmacy in unique_pharmacies)
        addresses = " ".join(f"{pharmacy.name} : {pharmacy.address}." for pharmacy in unique_pharmacies)
        return (
            f"Je n'ai pas trouvé exactement le dosage {requested_dosage}. "
            f"En revanche, des alternatives de ce médicament sont disponibles dans les pharmacies {names}. "
            f"Voici leurs adresses exactes : {addresses}"
        )
    
    def _answer_pharmacy_question(self, question: str, user=None) -> str:
        """Answer questions about pharmacies"""
        
        # How many pharmacies?
        if 'combien' in question and 'pharmacie' in question:
            count = Pharmacy.objects.count()
            return f"Je peux vous dire qu'il y a actuellement {count} pharmacies actives sur PharmiGo prêtes à vous servir."
        
        # List pharmacies
        elif 'liste' in question or 'quelles' in question:
            pharmacies = Pharmacy.objects.all()[:10]
            pharmacy_list = "\n".join([
                f"• {ph.name} - {ph.city}" for ph in pharmacies
            ])
            return f"Voici quelques pharmacies disponibles :\n{pharmacy_list}\n\nJe peux vous aider à trouver celle qui correspond le mieux à vos besoins."
        
        # Open pharmacies
        elif 'ouverte' in question or 'disponible' in question:
            count = Pharmacy.objects.count()
            return f"{count} pharmacies sont actuellement disponibles sur la plateforme pour répondre à vos besoins."
        
        else:
            return "Je peux vous aider à trouver des pharmacies. Dites-moi ce que vous cherchez : nombre, liste, ou disponibilité."
    
    def _answer_prescription_question(self, question: str, user=None) -> str:
        """Answer questions about prescriptions"""
        
        # User's prescriptions
        if user and ('mes' in question or 'mon' in question):
            if user.profile and user.profile.role == 'patient':
                count = Prescription.objects.filter(patient_user=user).count()
                return f"J'ai vérifié mes données : vous avez {count} ordonnance(s) sur la plateforme. Je peux vous aider à consulter votre dashboard pour les détails."
            else:
                return "En tant que pharmacie, je ne peux pas avoir d'ordonnances personnelles. Je suis là pour servir les patients."
        
        # Total prescriptions
        elif 'combien' in question:
            count = Prescription.objects.count()
            return f"Je peux vous informer qu'il y a {count} ordonnances au total sur PharmiGo."
        
        # Prescription status
        elif 'statut' in question or 'status' in question:
            statuses = Prescription.objects.values('status').annotate(count=Count('id'))
            status_list = "\n".join([
                f"• {s['status']}: {s['count']}" for s in statuses
            ])
            return f"Voici la répartition des statuts :\n{status_list}"
        
        else:
            return "Je peux vous renseigner sur vos ordonnances ou les statistiques globales. Que souhaitez-vous savoir ?"
    
    def _answer_medication_question(self, question: str, user=None) -> str:
        """Answer questions about medications and stock"""
        
        # Available medications at a specific pharmacy
        if user and user.profile and user.profile.role == 'pharmacy':
            try:
                pharmacy = Pharmacy.objects.get(user=user)
                stock_count = PharmacyStock.objects.filter(pharmacy=pharmacy, is_available=True).count()
                return f"J'ai vérifié mon stock : ma pharmacie a {stock_count} médicaments disponibles pour servir les patients."
            except Pharmacy.DoesNotExist:
                return "Je n'ai pas de pharmacie associée à mon compte."
        
        # Most common medications
        elif 'courant' in question or 'populaire' in question:
            top_meds = PharmacyStock.objects.values('medication_name').annotate(
                count=Count('id')
            ).order_by('-count')[:5]
            med_list = "\n".join([
                f"• {m['medication_name']}: {m['count']} pharmacies" for m in top_meds
            ])
            return f"Les médicaments les plus courants que j'ai trouvés :\n{med_list}"
        
        else:
            return "Je peux vous renseigner sur le stock des médicaments. Êtes-vous une pharmacie ou un patient ?"
    
    def _answer_account_question(self, question: str, user=None) -> str:
        """Answer questions about user account"""
        
        if not user:
            return "Veuillez vous connecter pour que je puisse accéder à vos informations."
        
        if user.profile:
            role = user.profile.role
            if role == 'patient':
                return f"Je suis connecté en tant que patient.\nNom: {user.username}\nEmail: {user.email}"
            elif role == 'pharmacy':
                try:
                    pharmacy = Pharmacy.objects.get(user=user)
                    return f"Je suis connecté en tant que pharmacie.\nNom: {pharmacy.name}\nVille: {pharmacy.city}"
                except Pharmacy.DoesNotExist:
                    return "Je suis une pharmacie mais mes informations ne sont pas complètes."
        
        return "Veuillez compléter votre profil pour que je puisse vous donner plus d'informations."

    def _get_usage_response(self) -> str:
        return (
            "Voici comment utiliser PharmiGo :\n"
            "1. Publiez votre ordonnance dans le formulaire dédié.\n"
            "2. Le chatbot analyse immédiatement le texte ou l'image.\n"
            "3. Une réponse s'affiche en popup avec les médicaments reconnus.\n"
            "4. PharmiGo cherche les pharmacies ayant ces médicaments en stock.\n"
            "5. Vous choisissez la pharmacie proposée puis vous recevez les notifications de suivi."
        )
    
    def _get_default_response(self) -> str:
        """Get default response when question is not understood"""
        return (
            "Je suis PharmiGo. Je peux vous accompagner sur vos questions de sante, "
            "de bien-etre, d'ordonnances, de pharmacies et de medicaments, "
            "avec des reponses prudentes et humaines. Comment puis-je vous aider aujourd'hui ?"
        )
