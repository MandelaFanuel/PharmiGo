# Architecture et Fonctionnement de PharmiGo

## Vue d'ensemble

PharmiGo est une plateforme web concue pour accelerer la recherche de medicaments au Burundi et en RDC. Elle relie trois groupes d'acteurs autour d'un meme flux :

- les patients qui publient une ordonnance ou un besoin medicamenteux
- les pharmacies qui declarent leur stock, repondent et servent
- les administrateurs qui pilotent la plateforme, les abonnements, les paiements et la qualite operationnelle

La valeur de PharmiGo ne repose pas sur un simple annuaire. La plateforme croise :

- les ordonnances publiees
- les medicaments extraits et confirmes
- les stocks renseignes par les pharmacies
- les reponses, delais et prix proposes
- les horaires, la livraison et la localisation

Le resultat est un parcours plus concret : publier, verifier, comparer, choisir, suivre et confirmer.

## Utilite dans la communaute

### Pour les patients

- Reduire les deplacements inutiles entre pharmacies.
- Eviter les appels repetitifs pour savoir si un medicament est disponible.
- Mieux comprendre l'etat d'avancement d'une ordonnance.
- Recevoir une orientation plus utile grace aux stocks, a la proximite et aux horaires.

### Pour les pharmacies

- Gagner en visibilite sur des demandes reelles.
- Transformer le stock declare en opportunite commerciale plus directe.
- Repondre plus vite et mieux structurer le suivi des ordonnances.
- Utiliser un tableau de bord centralise pour l'activite, le stock, les paiements et l'abonnement.

### Pour l'ecosysteme local

- Rendre la circulation de l'information medicamenteuse plus rapide.
- Mieux exploiter les stocks deja presents sur le terrain.
- Soutenir un usage mobile et multilingue adapte au contexte local.
- Produire un cadre plus lisible pour la coordination entre patients, pharmacies et supervision.

## Ce qui distingue PharmiGo

- **Le stock reel guide la recommandation** : la plateforme ne montre pas seulement des pharmacies, elle cherche celles qui peuvent repondre a une demande avec des donnees de stock et de disponibilite.
- **OCR + IA + validation humaine** : une ordonnance peut etre analysee automatiquement, puis corrigee et confirmee avant d'etre diffusee.
- **Approche locale** : langues multiples, horaires reels, livraison, geolocalisation et abonnement pharmacie sont integres dans le parcours.
- **Temps reel** : notifications, flux, tableaux de bord et presences s'actualisent avec les evenements de la plateforme.
- **Experience communautaire** : pharmacies publiques, ordonnances confirmees, commentaires, likes et partages rendent l'accueil plus vivant qu'un simple moteur de recherche.

## Architecture technique

### Backend

- **Django**
- **Django REST Framework**
- **Django Channels**
- **PostgreSQL**
- **Redis**

Applications principales :

- `users` : comptes, profils, roles, presence, geolocalisation IP et navigateur
- `pharmacies` : annuaire, commentaires, engagements, abonnements, paiements, parametrage abonnement
- `prescriptions` : ordonnances, OCR, confirmations, reponses pharmacies, historique, interactions
- `notifications` : notifications ciblees et globales
- `chat` : echanges en temps reel
- `pharmigo_chatbot` : assistant conversationnel, recherche medicamenteuse et distance

### Frontend

- **React**
- **TypeScript**
- **Vite**

Le frontend propose :

- une home page publique et responsive
- des dashboards differencies pour patient, pharmacie et administrateur
- un assistant flottant
- un viewer de documents integre
- la gestion du theme et des langues

## Fonctionnalites actuelles exactes

### 1. Accueil public

La home page affiche :

- les pharmacies publiques disponibles
- les ordonnances ou medicaments confirmes affichables publiquement selon le role
- les horaires d'ouverture et le statut ouvert/ferme
- la disponibilite de livraison
- des interactions sociales : like, commentaire, partage
- la recherche dans le repertoire
- la pagination des cartes affichees

Elle sert aussi de point d'entree pour :

- la connexion
- l'inscription patient ou pharmacie
- la publication d'une ordonnance
- le centre de notifications
- l'ouverture des dashboards

### 2. Parcours patient

Le patient peut :

- creer un compte et se connecter
- synchroniser sa localisation
- publier une ordonnance sous forme d'image ou de PDF
- suivre l'analyse OCR et Gemini
- confirmer ou corriger manuellement les medicaments extraits
- consulter les ordonnances originales dans un espace prive
- suivre l'historique et les changements de statut
- recevoir des notifications liees aux reponses pharmacies et a l'avancement
- ouvrir les documents dans le viewer integre

### 3. Analyse d'ordonnance

Le flux d'analyse actuel comprend :

- stockage prive du document original
- extraction OCR
- analyse Gemini quand activee
- calcul d'un score de confiance
- production d'une liste de medicaments, dosage, forme, quantite et posologie
- confirmation manuelle quand l'analyse reste incertaine

Ce flux est central, car il structure ensuite la recherche, les reponses et les recommandations.

### 4. Parcours pharmacie

La pharmacie peut :

- creer un compte professionnel
- completer son profil public
- definir horaires, photo, adresse, telephone et livraison
- gerer son stock de medicaments
- ajouter, modifier, supprimer et ajuster les quantites
- voir les ordonnances disponibles et les verifications OCR
- repondre a une demande avec prix, delai et disponibilite
- suivre l'activite servie et l'historique
- consulter son abonnement, son essai et ses paiements
- televerser une preuve de paiement d'abonnement

### 5. Gestion du stock

Le stock constitue aujourd'hui une fonctionnalite structurante. Il permet :

- l'ajout d'un medicament avec dosage, quantite, unite, prix et disponibilite
- la modification et la suppression
- l'ajustement rapide par boutons `+` et `-`
- l'exploitation directe du stock par les recommandations pharmacies
- l'exploitation du stock par le chatbot lors d'une recherche medicamenteuse

### 6. Parcours administrateur

Le dashboard admin permet de :

- superviser les performances globales
- suivre les activites systeme et metriques chatbot
- gerer les pharmacies et les patients
- consulter les ordonnances originales
- consulter les medicaments confirmes issus de l'OCR
- ajuster les reglages d'abonnement
- definir les moyens de paiement disponibles
- activer, suspendre, expirer ou reactiver des abonnements
- verifier l'historique des paiements
- envoyer des notifications globales
- modifier le profil administrateur

### 7. Notifications et temps reel

Le systeme de notifications couvre actuellement :

- les nouvelles reponses pharmacies
- les changements d'etat d'une ordonnance
- les messages ou evenements critiques
- les diffusions globales admin

Le temps reel n'est pas seulement decoratif. Il est utilise pour :

- rafraichir les dashboards
- refléter les changements de presence
- synchroniser certaines mises a jour de flux et d'activite

### 8. Chatbot et recherche intelligente

L'assistant PharmiGo peut actuellement :

- expliquer le fonctionnement de la plateforme
- recevoir une question texte ou une image/PDF
- s'appuyer sur des connaissances internes
- rechercher des medicaments dans les stocks reels
- proposer des pharmacies correspondantes
- calculer la distance quand les coordonnees du patient et de la pharmacie sont disponibles
- indiquer l'adresse, le telephone, le prix, la quantite et la distance estimee

La distance devient plus fiable lorsque la geolocalisation navigateur ou IP est correctement enregistree sur le profil et la pharmacie.

### 9. Geolocalisation

Le systeme de localisation actuel combine :

- IP connue de l'utilisateur
- coordonnees latitude/longitude du profil
- synchronisation des coordonnees vers la fiche pharmacie
- geolocalisation navigateur lorsque l'utilisateur l'autorise

Cette base permet :

- de presenter les pharmacies les plus proches
- d'aider le chatbot a classer les options
- d'afficher des distances plus parlantes dans les recommandations

### 10. Abonnement pharmacie et paiements

Le module de paiement actuellement present concerne surtout l'activation des pharmacies :

- essai initial
- abonnement actif ou suspendu
- prix mensuel parametrable
- moyens de paiement parametrables
- preuves de paiement
- verification admin

Ce module ne correspond pas encore a un paiement patient finalise de bout en bout pour l'achat d'un medicament. Il sert avant tout au pilotage abonnement des pharmacies.

## Comment la plateforme fonctionne, en theorie

### Cycle complet

1. Le patient publie une ordonnance.
2. Le systeme lit le document et propose une extraction.
3. Les medicaments sont confirmes.
4. La plateforme diffuse la demande et la compare au stock.
5. Les pharmacies repondent.
6. Le patient compare et choisit.
7. La pharmacie sert et met a jour le statut.
8. Les notifications, l'historique et les tableaux de bord suivent tout le cycle.

### Logique de valeur

PharmiGo ne cherche pas seulement a "montrer". Il cherche a :

- **rendre visible** une demande reelle
- **verifier** le contenu utile de l'ordonnance
- **orienter** vers une pharmacie exploitable
- **suivre** la demande jusqu'a son aboutissement

Cette logique complete explique pourquoi la plateforme peut etre plus utile qu'un simple annuaire ou qu'un chat isole.

## Ce que la documentation publique ne doit plus pretendre

Pour rester fidele a l'etat actuel du code, il ne faut plus presenter PharmiGo comme :

- une solution USSD deja disponible
- une application native distincte deja livree
- une plateforme de teleconsultation deja en service
- un systeme blockchain operationnel dans les flux metier
- un chiffrement de bout en bout explicitement implemente dans toute la plateforme

Ces points peuvent relever d'une vision future, mais ils ne doivent pas etre presentes comme des fonctionnalites actuelles.

## Conclusion

PharmiGo est aujourd'hui une plateforme orientee terrain : publication d'ordonnance, lecture assistee, verification, suggestion par stock reel, reponse pharmacie, suivi du service, supervision admin et accompagnement conversationnel.

Sa force est de relier l'information medicamenteuse, la disponibilite reelle et la proximite dans une meme experience. C'est cette combinaison qui lui donne sa vraie singularite dans la communaute.
