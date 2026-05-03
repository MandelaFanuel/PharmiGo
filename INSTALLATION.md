# PharmiGo - Installation et Configuration

## 🚀 Installation Rapide

### 1. Installation des dépendances Backend

```bash
cd backend

# Installer les dépendances Python
pip install -r requirements.txt

# Installer Tesseract OCR (selon votre système)
# Ubuntu/Debian:
sudo apt-get install tesseract-ocr tesseract-ocr-fra

# macOS:
brew install tesseract tesseract-lang

# Windows: Télécharger depuis https://github.com/UB-Mannheim/tesseract/wiki
```

### 2. Configuration de la base de données

```bash
# Appliquer les migrations
python manage.py makemigrations pharmigo_chatbot
python manage.py migrate

# Créer un superutilisateur (admin)
python manage.py createsuperuser

# Peupler la base de données des médicaments (optionnel)
# Via l'API: POST /api/admin/populate-medicines/ (admin only)
```

### 3. Lancer le serveur Backend

```bash
python manage.py runserver
```

### 4. Installation du Frontend

```bash
cd frontend

# Installer les dépendances npm
npm install

# Lancer le serveur de développement
npm run dev
```

## 🤖 Fonctionnalités du Chatbot Intelligent

### Analyse d'Ordonnances
- **OCR Intelligent** : Utilise Tesseract avec prétraitement d'image
- **Extraction de médicaments** : Reconnaît les noms, dosages et formes pharmaceutiques
- **Fuzzy matching** : Correspondance même avec des erreurs d'OCR
- **Base de données médicaments** : 50+ médicaments courants avec synonymes

### Workflow Complet
1. Patient publie une ordonnance
2. Chatbot analyse l'image
3. Extraction et confirmation des médicaments
4. Recherche automatique dans les pharmacies
5. Liste des pharmacies disponibles
6. Patient choisit une pharmacie
7. Suivi jusqu'à la livraison

### Chatbot Conversationnel
- Réponses contextuelles intelligentes
- Support multilingue (FR, EN, RN, SW, LN)
- Intégration avec le flux de prescriptions
- Interface moderne et intuitive

## 📱 Interface Utilisateur

### Chatbot Flottant
- Bouton rond en bas à droite de la page d'accueil
- Fenêtre de chat moderne avec animations
- Support des emojis et formatage de texte
- Indicateur de frappe en temps réel

### Design Professionnel
- Couleurs PharmiGo (#22c55e)
- Responsive design
- Support dark mode
- Accessible (ARIA labels)

## 🔧 Configuration Avancée

### Variables d'environnement
```bash
# Backend (.env)
SECRET_KEY=votre_secret_key
DEBUG=True
ALLOWED_HOSTS=localhost,127.0.0.1

# Frontend (.env)
VITE_API_BASE_URL=http://localhost:8000/api
```

### Ajout de médicaments
La base de données peut être étendue en modifiant `MedicineDatabase.COMMON_MEDICINES` dans `services.py`.

## 🧪 Tests

### Backend
```bash
python manage.py test
```

### Frontend
```bash
npm test
```

## 📊 Architecture

- **Backend** : Django REST Framework
- **Frontend** : React + TypeScript + Vite
- **OCR** : Tesseract + OpenCV
- **Matching** : FuzzyWuzzy (Levenshtein)
- **Base de données** : PostgreSQL (production) / SQLite (dev)

## 🎯 Prochaines Étapes

1. **Améliorer l'OCR** : Intégrer Google Vision API pour une meilleure précision
2. **Modèle IA** : Entraîner un modèle spécifique pour les ordonnances médicales
3. **Mobile** : Développer une application React Native
4. **Paiement** : Intégrer les paiements mobiles (M-Pesa, etc.)
5. **Livraison** : Système de suivi de livraison en temps réel

## 📞 Support

Pour toute question ou problème, contactez :
- Email : contact@pharmigo.app
- Téléphone : +257 69 906 758

---

**PharmiGo** - La révolution de l'accès aux médicaments au Burundi et en RDC 🚀