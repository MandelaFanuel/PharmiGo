from django.core.management.base import BaseCommand

from apps.pharmigo_chatbot.models import ChatbotKnowledgeBase


KNOWLEDGE_SEED = [
    {
        "category": "accueil",
        "role_target": "all",
        "question": "Qu'est-ce que PharmiGo ?",
        "answer": "PharmiGo est une plateforme qui aide les patients à publier leurs ordonnances et à trouver rapidement les pharmacies disposant des médicaments nécessaires.",
        "keywords": "pharmigo plateforme medicament pharmacie ordonnance",
    },
    {
        "category": "inscription",
        "role_target": "patient",
        "question": "Comment un patient peut-il créer un compte ?",
        "answer": "Vous creez votre compte avec vos informations de base, puis vous accedez a votre dashboard pour publier vos ordonnances et ajouter votre adresse actuelle.",
        "keywords": "inscription patient compte créer",
    },
    {
        "category": "inscription",
        "role_target": "pharmacy",
        "question": "Comment une pharmacie peut-elle créer un compte ?",
        "answer": "Votre pharmacie cree un compte professionnel, complete son profil, ajoute son adresse, puis commence a gerer ses medicaments et son stock.",
        "keywords": "inscription pharmacie compte professionnel",
    },
    {
        "category": "connexion",
        "role_target": "all",
        "question": "Comment se connecter à PharmiGo ?",
        "answer": "Vous vous connectez avec vos identifiants. Apres connexion, vous revenez sur la page d'accueil et vous pouvez librement aller dans votre dashboard ou continuer a naviguer.",
        "keywords": "connexion login dashboard",
    },
    {
        "category": "dashboard_patient",
        "role_target": "patient",
        "question": "Que peut faire un patient dans son dashboard ?",
        "answer": "Vous pouvez gerer votre profil, ajouter votre adresse actuelle, publier une ordonnance, suivre vos ordonnances, voir les reponses des pharmacies, choisir une pharmacie et confirmer l'achat.",
        "keywords": "dashboard patient profil adresse ordonnance",
    },
    {
        "category": "dashboard_pharmacie",
        "role_target": "pharmacy",
        "question": "Que peut faire une pharmacie dans son dashboard ?",
        "answer": "Votre pharmacie peut gerer son profil, ajouter ou modifier ses medicaments, gerer son stock, repondre aux ordonnances publiees, discuter avec d'autres pharmacies et confirmer qu'une ordonnance a ete servie.",
        "keywords": "dashboard pharmacie stock medicament ordonnance chat",
    },
    {
        "category": "adresse",
        "role_target": "patient",
        "question": "Pourquoi le patient doit-il ajouter son adresse ?",
        "answer": "Votre adresse permet au chatbot de vous proposer les pharmacies les plus proches qui possedent les medicaments recherches.",
        "keywords": "adresse patient geolocalisation pharmacie proche",
    },
    {
        "category": "adresse",
        "role_target": "pharmacy",
        "question": "Pourquoi une pharmacie doit-elle ajouter son adresse ?",
        "answer": "L'adresse de votre pharmacie permet au systeme de calculer sa proximite avec les patients et d'ameliorer les recommandations du chatbot.",
        "keywords": "adresse pharmacie geolocalisation distance",
    },
    {
        "category": "ordonnance",
        "role_target": "patient",
        "question": "Comment publier une ordonnance ?",
        "answer": "Depuis la page d'accueil ou votre dashboard, vous cliquez sur publier une ordonnance, vous ajoutez une image claire ou une capture, puis vous validez la publication.",
        "keywords": "publier ordonnance image capture",
    },
    {
        "category": "ordonnance",
        "role_target": "all",
        "question": "Que se passe-t-il après la publication d'une ordonnance ?",
        "answer": "L'ordonnance devient visible aux pharmacies. Je l'analyse, j'extrais les medicaments et je recherche les pharmacies qui peuvent les fournir.",
        "keywords": "publication ordonnance analyse pharmacie",
    },
    {
        "category": "chatbot",
        "role_target": "all",
        "question": "Quel est le rôle du chatbot PharmiGo ?",
        "answer": "J'accueille les utilisateurs, j'explique la plateforme, j'analyse les ordonnances, j'extrais les medicaments, je demande confirmation en cas de doute, je recherche les pharmacies disponibles et j'oriente le patient.",
        "keywords": "chatbot assistant analyse ordonnance",
    },
    {
        "category": "chatbot",
        "role_target": "all",
        "question": "Le chatbot peut-il décider seul ?",
        "answer": "Non. Je propose et j'assiste, mais les decisions importantes doivent etre confirmees par le patient ou la pharmacie.",
        "keywords": "chatbot decision confirmation",
    },
    {
        "category": "analyse_ordonnance",
        "role_target": "all",
        "question": "Comment le chatbot analyse une ordonnance ?",
        "answer": "J'utilise l'OCR et l'intelligence artificielle pour lire l'image, detecter les medicaments, reconnaitre les dosages et produire une liste structuree.",
        "keywords": "ocr analyse image medicament dosage",
    },
    {
        "category": "confirmation",
        "role_target": "patient",
        "question": "Pourquoi confirmer les médicaments détectés ?",
        "answer": "Votre confirmation evite les erreurs liees aux ecritures difficiles ou aux images floues. Vous validez ou corrigez les medicaments detectes avant la recherche des pharmacies.",
        "keywords": "confirmation medicament erreur ordonnance",
    },
    {
        "category": "stock",
        "role_target": "pharmacy",
        "question": "Comment ajouter un médicament au stock ?",
        "answer": "Depuis le dashboard pharmacie, ouvrez la gestion du stock, cliquez sur ajouter un medicament, renseignez le nom, le dosage, la quantite et le prix, puis enregistrez.",
        "keywords": "ajouter medicament stock prix quantite",
    },
    {
        "category": "stock",
        "role_target": "pharmacy",
        "question": "Comment modifier un médicament ?",
        "answer": "Votre pharmacie peut modifier les informations d'un medicament depuis son dashboard : nom, dosage, prix, quantite et disponibilite.",
        "keywords": "modifier medicament stock",
    },
    {
        "category": "stock",
        "role_target": "all",
        "question": "Comment le chatbot utilise les stocks ?",
        "answer": "Je compare les medicaments extraits de l'ordonnance avec les stocks des pharmacies pour identifier celles qui disposent reellement des medicaments.",
        "keywords": "stock chatbot disponibilite pharmacie",
    },
    {
        "category": "recommandation",
        "role_target": "patient",
        "question": "Comment le chatbot propose une pharmacie ?",
        "answer": "Je tiens compte des medicaments disponibles, des stocks, des prix, de votre adresse et de l'adresse des pharmacies pour vous proposer les meilleures options.",
        "keywords": "recommandation pharmacie distance prix stock",
    },
    {
        "category": "choix_pharmacie",
        "role_target": "patient",
        "question": "Comment choisir une pharmacie ?",
        "answer": "Vous consultez la liste des pharmacies proposees, vous comparez la disponibilite, le prix et la distance, puis vous cliquez sur choisir cette pharmacie.",
        "keywords": "choisir pharmacie patient",
    },
    {
        "category": "ordonnance_servie",
        "role_target": "all",
        "question": "Comment une ordonnance devient-elle servie ?",
        "answer": "La pharmacie clique sur ordonnance servie apres avoir remis les medicaments. Ensuite, vous confirmez l'achat. L'ordonnance est alors classee comme deja servie.",
        "keywords": "ordonnance servie confirmation patient pharmacie",
    },
    {
        "category": "interactions_publiques",
        "role_target": "all",
        "question": "Comment se passent les échanges patient-pharmacie ?",
        "answer": "Les echanges entre patients et pharmacies se font publiquement via les interactions sur les ordonnances afin de garantir la transparence et de m'aider a mieux analyser le contexte.",
        "keywords": "interaction publique ordonnance patient pharmacie",
    },
    {
        "category": "chat_pharmacie",
        "role_target": "pharmacy",
        "question": "Le chat est-il disponible entre patient et pharmacie ?",
        "answer": "Non. Le chat prive est reserve aux echanges entre pharmacies. Les interactions patient-pharmacie restent publiques via les ordonnances.",
        "keywords": "chat pharmacie patient privé",
    },
    {
        "category": "chat_pharmacie",
        "role_target": "pharmacy",
        "question": "Comment une pharmacie peut-elle ajouter un contact ?",
        "answer": "Votre pharmacie selectionne une autre pharmacie existante dans la liste, puis l'ajoute a ses contacts pour pouvoir discuter rapidement avec elle.",
        "keywords": "contact pharmacie ajouter chat",
    },
    {
        "category": "notifications",
        "role_target": "patient",
        "question": "Quelles notifications reçoit un patient ?",
        "answer": "Vous recevez des notifications lorsqu'une pharmacie repond a votre ordonnance, lorsqu'une pharmacie est proposee, lorsqu'une ordonnance est declaree servie ou lorsqu'une confirmation est necessaire.",
        "keywords": "notification patient ordonnance pharmacie",
    },
    {
        "category": "notifications",
        "role_target": "pharmacy",
        "question": "Quelles notifications reçoit une pharmacie ?",
        "answer": "Votre pharmacie recoit des notifications pour les nouvelles ordonnances, les messages recus, les choix des patients et les confirmations liees aux ordonnances servies.",
        "keywords": "notification pharmacie message ordonnance",
    },
    {
        "category": "page_accueil",
        "role_target": "all",
        "question": "Que doit afficher la page d'accueil ?",
        "answer": "La page d'accueil affiche en temps reel les pharmacies, les ordonnances publiees, les commentaires, les likes, les partages et les interactions importantes.",
        "keywords": "page accueil pharmacie ordonnance commentaire like share",
    },
    {
        "category": "temps_reel",
        "role_target": "all",
        "question": "Quelles parties doivent fonctionner en temps réel ?",
        "answer": "Les messages, notifications, stocks, ordonnances, commentaires, likes, partages, dashboards, recommandations du chatbot et la page d'accueil doivent se mettre a jour en temps reel.",
        "keywords": "temps réel websocket notification dashboard",
    },
    {
        "category": "confidentialite",
        "role_target": "all",
        "question": "Les données du patient sont-elles privées ?",
        "answer": "Oui. Le profil du patient reste prive. Les ordonnances sont visibles aux pharmacies selon les regles de la plateforme, mais les informations personnelles sensibles doivent etre protegees.",
        "keywords": "confidentialite patient données privées",
    },
    {
        "category": "support",
        "role_target": "all",
        "question": "Que faire si une erreur se produit ?",
        "answer": "Vous devez recevoir un message clair. Le systeme enregistre aussi l'erreur cote backend afin que l'equipe puisse la corriger rapidement.",
        "keywords": "erreur support bug",
    },
]


class Command(BaseCommand):
    help = "Seed PharmiGo chatbot knowledge base."

    def handle(self, *args, **options):
        created = 0
        updated = 0
        for item in KNOWLEDGE_SEED:
            _, was_created = ChatbotKnowledgeBase.objects.update_or_create(
                question=item["question"],
                defaults=item,
            )
            if was_created:
                created += 1
            else:
                updated += 1

        self.stdout.write(self.style.SUCCESS(f"Knowledge base seeded. created={created} updated={updated}"))
