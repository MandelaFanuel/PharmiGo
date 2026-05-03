# Spécification Technique - Chatbot Intelligent d'Analyse d'Ordonnances PharmiGo

## 📋 Table des Matières
1. [Vue d'ensemble du système](#vue-densemble-du-système)
2. [Architecture technique](#architecture-technique)
3. [Workflow complet](#workflow-complet)
4. [Composants IA et OCR](#composants-ia-et-ocr)
5. [Base de données et schéma](#base-de-données-et-schéma)
6. [API specifications](#api-specifications)
7. [Interface utilisateur](#interface-utilisateur)
8. [Sécurité et confidentialité](#sécurité-et-confidentialité)

---

## 🎯 Vue d'ensemble du système

### Objectif principal
Créer un chatbot intelligent spécialisé dans l'analyse automatique d'ordonnances médicales, capable de :
- Accueillir le patient et lui expliquer clairement comment utiliser la plateforme
- Analyser les images d'ordonnances, y compris des écritures médicales variées
- Extraire automatiquement les médicaments, dosages et quantités prescrits
- Demander une confirmation au patient, et au besoin au pharmacien, lorsque certains éléments sont ambigus
- Rechercher en temps réel les disponibilités dans les pharmacies enregistrées sur la plateforme
- Orienter le patient vers une ou plusieurs pharmacies capables de servir l'ordonnance
- Permettre au patient de choisir sa pharmacie via un bouton d'action disponible sur chaque résultat
- Suivre l'ordonnance jusqu'à la confirmation finale d'achat et son classement comme "déjà servie"

### Vision produit
Le chatbot PharmiGo n'est pas seulement un assistant conversationnel. C'est un orchestrateur intelligent du parcours ordonnance-to-pharmacie. Son rôle est de réduire le temps entre la publication d'une ordonnance et l'achat effectif des médicaments, tout en limitant les erreurs d'interprétation et en gardant l'humain dans la boucle quand cela est nécessaire.

### Principe d'intelligence attendu
Le chatbot doit être capable de reconnaître des ordonnances rédigées avec différentes écritures de médecins, mais il ne doit jamais prétendre à une exactitude absolue sans validation. L'intelligence du système repose sur quatre piliers :
- OCR et reconnaissance d'écriture pour lire l'ordonnance
- NLP médical pour identifier les médicaments, dosages et quantités
- Score de confiance pour détecter les zones incertaines
- Confirmation humaine pour fiabiliser le résultat avant toute recherche en pharmacie

### Résultat attendu pour l'utilisateur
À la fin du processus, le patient doit pouvoir :
- Comprendre comment utiliser la plateforme dès son arrivée
- Publier son ordonnance facilement
- Voir les médicaments détectés et les corriger si nécessaire
- Recevoir une liste fiable des pharmacies disposant des médicaments
- Choisir une pharmacie en quelques clics
- Suivre en temps réel l'état de préparation et de délivrance
- Confirmer l'achat final pour clôturer correctement l'ordonnance

### Public cible
- **Patients** : Upload d'ordonnances, confirmation, sélection de pharmacie
- **Pharmaciens** : Réception des demandes, préparation, confirmation de délivrance
- **Administrateurs** : Monitoring, gestion des erreurs, amélioration continue

---

## 🏗️ Architecture technique

### Stack technologique

#### Frontend
- **Framework** : React.js avec TypeScript
- **UI Components** : TailwindCSS + shadcn/ui
- **Image Upload** : react-dropzone
- **Camera Integration** : react-camera-pro
- **Real-time** : WebSocket pour les mises à jour en temps réel

#### Backend
- **Framework** : Django REST Framework
- **AI/ML Services** : FastAPI pour les services d'IA
- **OCR Engine** : Tesseract OCR + Google Cloud Vision API
- **Machine Learning** : TensorFlow/PyTorch pour la reconnaissance d'écriture
- **Database** : PostgreSQL
- **Cache** : Redis pour les performances

#### AI/OCR Services
- **OCR Principal** : Google Cloud Vision API
- **OCR Secondaire** : Tesseract OCR (backup)
- **Handwriting Recognition** : Custom CNN model
- **NLP Processing** : spaCy pour l'extraction d'entités médicamenteuses
- **Drug Database** : Integration avec bases de données médicamenteuses (Vidal, etc.)

### Architecture système

```
┌─────────────────────────────────────────────────────────────┐
│                      Frontend (React)                       │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐      │
│  │  Chat UI     │  │  Upload UI   │  │  Results UI  │      │
│  └──────────────┘  └──────────────┘  └──────────────┘      │
└─────────────────────────────────────────────────────────────┘
                            ↓ WebSocket
┌─────────────────────────────────────────────────────────────┐
│                   Backend (Django REST)                     │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐      │
│  │  API Gateway │  │  Auth Service│  │  Chat Engine │      │
│  └──────────────┘  └──────────────┘  └──────────────┘      │
└─────────────────────────────────────────────────────────────┘
                            ↓ REST API
┌─────────────────────────────────────────────────────────────┐
│                  AI/OCR Services (FastAPI)                  │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐      │
│  │  OCR Engine  │  │  ML Model    │  │  NLP Parser  │      │
│  └──────────────┘  └──────────────┘  └──────────────┘      │
└─────────────────────────────────────────────────────────────┘
                            ↓
┌─────────────────────────────────────────────────────────────┐
│                    Database (PostgreSQL)                    │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐      │
│  │  Users       │  │ Prescriptions│  │  Pharmacies  │      │
│  └──────────────┘  └──────────────┘  └──────────────┘      │
└─────────────────────────────────────────────────────────────┘
```

---

## 🔄 Workflow complet

### Étape 1 : Accueil et explication du chatbot

**Action** : Le patient accède à la plateforme
**Chatbot** : 
```
"👋 Bonjour ! Je suis votre assistant PharmiGo intelligent.
Je peux analyser votre ordonnance, confirmer les médicaments avec vous et trouver les pharmacies qui les ont disponibles.

Voici comment ça fonctionne :
1. 📸 Uploadez ou prenez une photo de votre ordonnance
2. 🔍 J'analyse l'image et je lis les médicaments prescrits
3. ✅ Je vous demande de confirmer si un nom, un dosage ou une quantité est douteux
4. 💊 Je recherche dans les pharmacies enregistrées celles qui ont vos médicaments
5. 🏥 Je vous affiche une ou plusieurs pharmacies disponibles
6. ✅ Vous choisissez la pharmacie qui vous convient
7. 📦 La pharmacie prépare et sert l'ordonnance
8. ✔️ Vous confirmez ensuite que l'achat a bien été effectué

Prêt à commencer ? 🚀"
```

**Objectif fonctionnel** :
- Mettre le patient en confiance
- Expliquer le parcours complet avant la première action
- Réduire les erreurs de manipulation dès l'entrée dans le système

### Étape 2 : Publication de l'ordonnance

**Interface** :
- Bouton "📸 Prendre une photo" (accès caméra)
- Bouton "📁 Uploader une image" (sélection fichier)
- Zone de drag & drop
- Prévisualisation de l'image
- Options de recadrage/amélioration

**Validation** :
- Format accepté : JPG, PNG, PDF
- Taille maximale : 10MB
- Résolution minimale : 1280x720
- Qualité suffisante pour OCR

**Résultat attendu** :
- L'image est enregistrée avec succès
- L'ordonnance reçoit immédiatement un identifiant unique
- Le statut passe en temps réel à `analyzing`
- Le patient voit sans rechargement que l'analyse a démarré

### Étape 3 : Analyse de l'image par le chatbot

**Processus technique** :
1. **Prétraitement de l'image**
   - Conversion en niveaux de gris
   - Amélioration du contraste
   - Réduction du bruit
   - Correction de l'inclinaison
   - Augmentation de la résolution

2. **OCR principal (Google Cloud Vision)**
   - Détection de texte
   - Reconnaissance de l'écriture manuscrite
   - Extraction des zones de texte
   - Confidence score par mot

3. **OCR secondaire (Tesseract)**
   - Backup si Google Vision échoue
   - Configuration personnalisée pour écriture médicale
   - Dictionnaire médical français

4. **Traitement NLP**
   - Tokenisation du texte
   - Reconnaissance d'entités médicamenteuses
   - Normalisation des noms de médicaments
   - Extraction des dosages et quantités

5. **Validation croisée**
   - Comparaison avec base de données médicamenteuses
   - Vérification des interactions possibles
   - Détection des médicaments inconnus

**Règle métier essentielle** :
- Le chatbot peut proposer une interprétation intelligente de l'ordonnance
- Si le score de confiance est faible, il ne doit pas valider automatiquement
- Toute donnée incertaine doit passer par une étape de confirmation humaine

### Étape 4 : Confirmation auprès du patient

**Interface de confirmation** :
```tsx
// Modal de confirmation
<ConfirmationModal>
  <Header>
    <h2>🔍 Confirmation des médicaments</h2>
    <p>J'ai identifié les médicaments suivants :</p>
  </Header>
  
  <MedicationList>
    {medications.map(med => (
      <MedicationItem>
        <MedicationName>{med.name}</MedicationName>
        <MedicationDosage>{med.dosage}</MedicationName>
        <MedicationQuantity>{med.quantity}</MedicationQuantity>
        <ConfirmButton onClick={() => confirmMedication(med.id)}>
          ✅ Correct
        </ConfirmButton>
        <EditButton onClick={() => editMedication(med.id)}>
          ✏️ Modifier
        </EditButton>
      </MedicationItem>
    ))}
  </MedicationList>
  
  <Actions>
    <Button onClick={confirmAll}>Tout confirmer ✅</Button>
    <Button onClick={requestCorrection}>Demander correction 📝</Button>
    <Button onClick={reuploadImage}>Re-uploader l'image 🔄</Button>
  </Actions>
</ConfirmationModal>
```

**Scénarios de gestion des erreurs** :
- **Confidence score faible** : Demande de confirmation manuelle
- **Médicament inconnu** : Suggestion de médicaments similaires
- **Dosage illisible** : Demande de confirmation au patient
- **Écriture très illisible** : Escalade vers support humain

**Cas d'usage métier** :
- Si le patient confirme, le système continue automatiquement
- Si le patient corrige, l'ordonnance est mise à jour avec la version validée
- Si le patient ne sait pas répondre, un pharmacien peut être sollicité pour validation
- Si l'image est inexploitable, le chatbot demande une nouvelle capture plus nette

### Étape 5 : Extraction et structuration des médicaments

**Structure de données** :
```typescript
interface Medication {
  id: string;
  name: string;           // Nom commercial
  genericName: string;    // Nom générique
  dosage: string;         // "500mg", "1cp", etc.
  quantity: number;       // Quantité prescrite
  unit: string;           // "comprimés", "flacons", etc.
  confidence: number;     // Score de confiance (0-1)
  alternatives: string[]; // Médicaments équivalents
  requiresPrescription: boolean;
}
```

**Algorithme d'extraction** :
1. Normalisation du texte OCR
2. Pattern matching pour dosages (regex)
3. Mapping avec base de données Vidal
4. Validation avec dictionnaire médical
5. Calcul du confidence score
6. Génération d'alternatives si nécessaire

**Sortie métier attendue** :
- Une liste propre et normalisée des médicaments
- Une distinction claire entre les éléments confirmés et les éléments encore douteux
- Une base exploitable pour la recherche multi-pharmacies

### Étape 6 : Recherche dans les stocks des pharmacies

**Algorithme de matching** :
```python
def find_pharmacies_with_medications(medications, user_location):
    """
    Recherche les pharmacies ayant tous les médicaments requis
    """
    candidate_pharmacies = []
    
    # Récupérer toutes les pharmacies actives
    pharmacies = Pharmacy.objects.filter(is_active=True, is_open=True)
    
    for pharmacy in pharmacies:
        # Vérifier disponibilité de chaque médicament
        available_medications = []
        missing_medications = []
        
        for med in medications:
            stock = PharmacyStock.objects.filter(
                pharmacy=pharmacy,
                medication_name=med.name
            ).first()
            
            if stock and stock.quantity >= med.quantity:
                available_medications.append(med)
            else:
                missing_medications.append(med)
        
        # Calculer le score de correspondance
        match_score = len(available_medications) / len(medications)
        
        # Calculer la distance
        distance = calculate_distance(user_location, pharmacy.location)
        
        if match_score >= 0.8:  # Au moins 80% des médicaments disponibles
            candidate_pharmacies.append({
                'pharmacy': pharmacy,
                'available': available_medications,
                'missing': missing_medications,
                'match_score': match_score,
                'distance': distance,
                'estimated_price': calculate_total_price(available_medications, pharmacy)
            })
    
    # Trier par pertinence (score de correspondance + distance)
    candidate_pharmacies.sort(key=lambda x: (
        -x['match_score'],  # Priorité au score de correspondance
        x['distance']       # Ensuite à la distance
    ))
    
    return candidate_pharmacies[:10]  # Top 10 pharmacies
```

**Comportement attendu** :
- La recherche se fait sur toutes les pharmacies actives enregistrées
- Le système privilégie d'abord les pharmacies qui ont 100% des médicaments prescrits
- Si aucune pharmacie ne couvre tout, il affiche celles qui couvrent le plus grand nombre de médicaments
- Les résultats doivent être rafraîchis en temps réel à partir des stocks les plus récents

### Étape 7 : Liste des pharmacies disponibles

**Interface de résultats** :
```tsx
<PharmacyResults>
  <Header>
    <h2>🏥 Pharmacies disponibles</h2>
    <p>{pharmacies.length} pharmacie(s) trouvée(s)</p>
  </Header>
  
  {pharmacies.map(pharmacy => (
    <PharmacyCard key={pharmacy.id}>
      <PharmacyInfo>
        <PharmacyName>{pharmacy.name}</PharmacyName>
        <PharmacyAddress>{pharmacy.address}</PharmacyAddress>
        <PharmacyDistance>{pharmacy.distance} km</PharmacyDistance>
        <AvailabilityBadge>
          {pharmacy.match_score * 100}% des médicaments disponibles
        </AvailabilityBadge>
      </PharmacyInfo>
      
      <MedicationAvailability>
        <AvailableMedications>
          {pharmacy.available.map(med => (
            <MedicationTag>{med.name}</MedicationTag>
          ))}
        </AvailableMedications>
        
        {pharmacy.missing.length > 0 && (
          <MissingMedications>
            <Warning>Manquant :</Warning>
            {pharmacy.missing.map(med => (
              <MissingTag>{med.name}</MissingTag>
            ))}
          </MissingMedications>
        )}
      </MedicationAvailability>
      
      <PharmacyActions>
        <Button onClick={() => selectPharmacy(pharmacy.id)}>
          🏥 Choisir cette pharmacie
        </Button>
        <Button onClick={() => viewOnMap(pharmacy.location)}>
          🗺️ Voir sur la carte
        </Button>
        <Button onClick={() => callPharmacy(pharmacy.phone)}>
          📞 Appeler
        </Button>
      </PharmacyActions>
      
      <PriceInfo>
        <EstimatedPrice>~{pharmacy.estimated_price} FCFA</EstimatedPrice>
      </PriceInfo>
    </PharmacyCard>
  ))}
</PharmacyResults>
```

**Règles d'affichage** :
- Si une seule pharmacie possède tous les médicaments, elle est mise en avant
- Si plusieurs pharmacies conviennent, elles sont listées de la plus pertinente à la moins pertinente
- Chaque carte doit afficher un bouton clair de sélection
- Le patient doit pouvoir voir immédiatement quels médicaments sont disponibles et lesquels sont manquants

### Étape 8 : Sélection de la pharmacie par le patient

**Processus de sélection** :
1. Patient clique sur "Choisir cette pharmacie"
2. Système envoie notification à la pharmacie
3. Pharmacie reçoit les détails de l'ordonnance
4. Statut de l'ordonnance passe à "en attente de préparation"

**Exigence temps réel** :
- Dès que le patient choisit une pharmacie, le tableau de bord de cette pharmacie doit être mis à jour sans délai perceptible
- Le patient doit voir immédiatement que sa demande a été transmise
- Tous les autres écrans connectés doivent refléter le nouveau statut sans rechargement manuel

**Données envoyées à la pharmacie** :
```typescript
interface PharmacyNotification {
  prescriptionId: string;
  patientInfo: {
    name: string;
    phone: string;
    location: Coordinates;
  };
  medications: Medication[];
  imageUrls: string[];
  timestamp: Date;
  estimatedArrival: Date;
}
```

### Étape 9 : Préparation par la pharmacie

**Interface pharmacie** :
```tsx
<PharmacyDashboard>
  <PrescriptionQueue>
    {pendingPrescriptions.map(prescription => (
      <PrescriptionCard>
        <PatientInfo>
          <PatientName>{prescription.patient.name}</PatientName>
          <PatientPhone>{prescription.patient.phone}</PatientName>
          <ArrivalTime>Arrivée estimée : {prescription.estimatedArrival}</ArrivalTime>
        </PatientInfo>
        
        <MedicationList>
          {prescription.medications.map(med => (
            <MedicationItem>
              <MedicationName>{med.name}</MedicationName>
              <MedicationDosage>{med.dosage}</MedicationDosage>
              <StockCheck>
                {checkStock(med) ? '✅ En stock' : '❌ Rupture'}
              </StockCheck>
            </MedicationItem>
          ))}
        </MedicationList>
        
        <Actions>
          <Button onClick={() => startPreparation(prescription.id)}>
            📦 Commencer la préparation
          </Button>
          <Button onClick={() => requestClarification(prescription.id)}>
            ❓ Demander clarification
          </Button>
          <Button onClick={() => declinePrescription(prescription.id)}>
            ❌ Décliner (stock insuffisant)
          </Button>
        </Actions>
      </PrescriptionCard>
    ))}
  </PrescriptionQueue>
</PharmacyDashboard>
```

**Comportement métier** :
- La pharmacie traite l'ordonnance depuis son dashboard en temps réel
- Elle peut accepter, demander une clarification ou signaler une indisponibilité
- Toute action de la pharmacie doit être visible immédiatement côté patient et côté administration

### Étape 10 : Confirmation "Ordonnance servie" par la pharmacie

**Processus** :
1. Pharmacie prépare les médicaments
2. Pharmacie clique "✅ Ordonnance servie"
3. Système envoie notification au patient
4. Statut passe à "servie - en attente confirmation patient"

**Exigence métier** :
- L'action "Ordonnance servie" doit être tracée avec horodatage
- Le patient doit recevoir une notification en temps réel
- Le dashboard pharmacie et le dashboard admin doivent être synchronisés instantanément

**Données de confirmation** :
```typescript
interface PharmacyConfirmation {
  prescriptionId: string;
  servedAt: Date;
  servedBy: string;  // ID du pharmacien
  medicationsServed: Medication[];
  totalAmount: number;
  paymentMethod: string;
  notes?: string;
}
```

### Étape 11 : Confirmation finale par le patient

**Interface patient** :
```tsx
<PatientConfirmation>
  <ConfirmationModal>
    <Header>
      <h2>✅ Confirmation de réception</h2>
      <p>Avez-vous bien reçu vos médicaments ?</p>
    </Header>
    
    <OrderSummary>
      <PharmacyName>{pharmacy.name}</PharmacyName>
      <ServedTime>Servi à : {servedAt}</ServedTime>
      <TotalAmount>Total : {totalAmount} FCFA</TotalAmount>
    </OrderSummary>
    
    <MedicationList>
      {medications.map(med => (
        <MedicationItem>
          <MedicationName>{med.name}</MedicationName>
          <Quantity>{med.quantity}</Quantity>
        </MedicationItem>
      ))}
    </MedicationList>
    
    <Actions>
      <Button onClick={confirmReceipt} variant="success">
        ✅ Oui, j'ai bien acheté
      </Button>
      <Button onClick={reportIssue} variant="warning">
        ⚠️ Problème avec la commande
      </Button>
    </Actions>
  </ConfirmationModal>
</PatientConfirmation>
```

**Clôture fonctionnelle** :
- Si le patient confirme "Oui, j'ai bien acheté", l'ordonnance passe à l'état final
- Si le patient signale un problème, l'ordonnance passe dans un circuit de support ou de litige
- Chaque confirmation finale doit être historisée pour audit et reporting

### Étape 12 : Classification de l'ordonnance

**Statuts de l'ordonnance** :
```typescript
enum PrescriptionStatus {
  UPLOADED = 'uploaded',           // Image uploadée
  ANALYZING = 'analyzing',         // Analyse OCR en cours
  CONFIRMATION_PENDING = 'confirmation_pending', // Attente confirmation patient
  CONFIRMED = 'confirmed',         // Médicaments confirmés
  SEARCHING = 'searching',         // Recherche pharmacies
  PHARMACY_SELECTED = 'pharmacy_selected', // Pharmacie choisie
  PREPARING = 'preparing',         // En préparation
  READY = 'ready',                 // Prêt à servir
  SERVED = 'served',               // Servi par pharmacie
  PATIENT_CONFIRMED = 'patient_confirmed', // Confirmé par patient
  COMPLETED = 'completed',         // Terminé avec succès
  CANCELLED = 'cancelled',         // Annulé
  ERROR = 'error'                  // Erreur
}
```

**Règle finale** :
- Une ordonnance confirmée par la pharmacie puis confirmée par le patient est classée comme `completed`
- Cette ordonnance doit être visible comme "déjà servie" dans l'historique
- Elle ne doit plus être proposée comme ordonnance active dans les tableaux de bord opérationnels

### Résumé métier du flux cible
```text
1. Patient publie une ordonnance
   ↓
2. Le chatbot analyse l'image de l'ordonnance
   ↓
3. Le chatbot demande confirmation au patient ou au pharmacien s'il y a un doute
   ↓
4. Après confirmation, il extrait les médicaments prescrits
   ↓
5. Il compare les médicaments avec les stocks des pharmacies
   ↓
6. Il liste les pharmacies qui possèdent les médicaments
   ↓
7. Le patient choisit une pharmacie
   ↓
8. La pharmacie prépare / sert les médicaments
   ↓
9. La pharmacie clique "Ordonnance servie"
   ↓
10. Le patient confirme "Oui, j'ai bien acheté"
   ↓
11. L'ordonnance est classée comme "déjà servie"
```

---

## 🤖 Composants IA et OCR

### Moteur OCR Principal (Google Cloud Vision API)

**Configuration** :
```python
from google.cloud import vision
from google.cloud.vision import types

class GoogleVisionOCR:
    def __init__(self):
        self.client = vision.ImageAnnotatorClient()
    
    def analyze_prescription(self, image_path):
        """Analyse une image d'ordonnance"""
        with open(image_path, 'rb') as image_file:
            content = image_file.read()
        
        image = vision.Image(content=content)
        
        # Détection de texte avec reconnaissance d'écriture
        response = self.client.document_text_detection(image=image)
        
        # Extraction des résultats
        text_annotations = response.text_annotations
        full_text = text_annotations[0].description if text_annotations else ""
        
        # Analyse de la confiance
        confidence_scores = [
            page.confidence 
            for page in response.full_text_annotation.pages
        ]
        
        avg_confidence = sum(confidence_scores) / len(confidence_scores)
        
        return {
            'text': full_text,
            'confidence': avg_confidence,
            'blocks': self._extract_blocks(response),
            'paragraphs': self._extract_paragraphs(response)
        }
```

### Moteur OCR Secondaire (Tesseract)

**Configuration personnalisée** :
```python
import pytesseract
from PIL import Image, ImageEnhance, ImageFilter

class TesseractOCR:
    def __init__(self):
        # Configuration optimisée pour écriture médicale française
        self.config = r'--oem 3 --psm 6 -l fra+eng'
        # Dictionnaire médical personnalisé
        self.medical_dict = self._load_medical_dictionary()
    
    def preprocess_image(self, image_path):
        """Prétraitement de l'image pour améliorer OCR"""
        img = Image.open(image_path)
        
        # Conversion en niveaux de gris
        img = img.convert('L')
        
        # Amélioration du contraste
        enhancer = ImageEnhance.Contrast(img)
        img = enhancer.enhance(2.0)
        
        # Réduction du bruit
        img = img.filter(ImageFilter.MedianFilter())
        
        # Augmentation de la résolution
        img = img.resize((img.width * 2, img.height * 2), Image.LANCZOS)
        
        return img
    
    def analyze_with_fallback(self, image_path):
        """Analyse avec fallback sur différentes configurations"""
        img = self.preprocess_image(image_path)
        
        # Essai avec configuration principale
        try:
            text = pytesseract.image_to_string(img, config=self.config)
            confidence = self._calculate_confidence(text)
            
            if confidence > 0.7:
                return {'text': text, 'confidence': confidence}
        except Exception as e:
            print(f"OCR principal échoué: {e}")
        
        # Fallback avec configuration alternative
        try:
            fallback_config = r'--oem 1 --psm 3 -l fra'
            text = pytesseract.image_to_string(img, config=fallback_config)
            return {'text': text, 'confidence': 0.5}
        except Exception as e:
            print(f"OCR fallback échoué: {e}")
            return {'text': '', 'confidence': 0.0}
```

### Modèle de reconnaissance d'écriture manuscrite

**Architecture CNN personnalisée** :
```python
import tensorflow as tf
from tensorflow.keras import layers, models

class HandwritingRecognitionModel:
    def __init__(self):
        self.model = self._build_model()
        self.model.load_weights('handwriting_model.h5')
    
    def _build_model(self):
        """Architecture CNN pour reconnaissance d'écriture"""
        model = models.Sequential([
            # Couche d'entrée
            layers.Input(shape=(128, 128, 1)),
            
            # Blocs convolutifs
            layers.Conv2D(32, (3, 3), activation='relu'),
            layers.MaxPooling2D((2, 2)),
            layers.Conv2D(64, (3, 3), activation='relu'),
            layers.MaxPooling2D((2, 2)),
            layers.Conv2D(128, (3, 3), activation='relu'),
            layers.MaxPooling2D((2, 2)),
            
            # Couches fully connected
            layers.Flatten(),
            layers.Dense(256, activation='relu'),
            layers.Dropout(0.5),
            layers.Dense(128, activation='relu'),
            layers.Dropout(0.3),
            
            # Couche de sortie (caractères médicaux)
            layers.Dense(len(self.medical_characters), activation='softmax')
        ])
        
        model.compile(
            optimizer='adam',
            loss='categorical_crossentropy',
            metrics=['accuracy']
        )
        
        return model
    
    def recognize_handwriting(self, image_region):
        """Reconnaissance d'écriture dans une région d'image"""
        # Prétraitement
        processed = self._preprocess_region(image_region)
        
        # Prédiction
        prediction = self.model.predict(processed)
        
        # Post-traitement
        character = self._postprocess_prediction(prediction)
        confidence = np.max(prediction)
        
        return {'character': character, 'confidence': confidence}
```

### Traitement NLP et extraction de médicaments

**Pipeline NLP avec spaCy** :
```python
import spacy
from spacy.matcher import Matcher

class MedicationExtractor:
    def __init__(self):
        self.nlp = spacy.load('fr_core_news_md')
        self.matcher = self._setup_medication_matcher()
        self.medication_db = self._load_medication_database()
    
    def _setup_medication_matcher(self):
        """Configuration du matcher pour médicaments"""
        matcher = Matcher(self.nlp.vocab)
        
        # Patterns pour noms de médicaments
        medication_patterns = [
            [{'LOWER': {'IN': self.medication_db['names']}}],
            [{'TEXT': {'REGEX': r'[A-Z][a-z]+®?'}}],  # Noms commerciaux
            [{'TEXT': {'REGEX': r'\d+\s*(mg|g|ml|cp|comprimé)'}}]  # Dosages
        ]
        
        for pattern in medication_patterns:
            matcher.add('MEDICATION', [pattern])
        
        return matcher
    
    def extract_medications(self, ocr_text):
        """Extraction des médicaments du texte OCR"""
        doc = self.nlp(ocr_text)
        matches = self.matcher(doc)
        
        medications = []
        for match_id, start, end in matches:
            span = doc[start:end]
            
            # Extraction des informations
            medication = {
                'text': span.text,
                'start': start,
                'end': end,
                'confidence': self._calculate_confidence(span)
            }
            
            # Normalisation
            normalized = self._normalize_medication(span.text)
            medication.update(normalized)
            
            medications.append(medication)
        
        return self._deduplicate_medications(medications)
    
    def _normalize_medication(self, text):
        """Normalisation du nom de médicament"""
        # Nettoyage du texte
        cleaned = text.strip().lower()
        
        # Recherche dans base de données
        for med in self.medication_db['medications']:
            if cleaned in med['aliases']:
                return {
                    'name': med['commercial_name'],
                    'generic_name': med['generic_name'],
                    'dosage': self._extract_dosage(text),
                    'alternatives': med['alternatives']
                }
        
        return {'name': text, 'generic_name': None, 'dosage': None}
```

### Base de données médicamenteuse

**Structure de la base Vidal** :
```python
class MedicationDatabase:
    def __init__(self):
        self.vidal_db = self._load_vidal_database()
        self.interaction_db = self._load_interaction_database()
    
    def search_medication(self, query):
        """Recherche de médicament avec fuzzy matching"""
        # Recherche exacte
        exact_match = self._exact_search(query)
        if exact_match:
            return exact_match
        
        # Recherche approximative
        fuzzy_matches = self._fuzzy_search(query, threshold=0.8)
        if fuzzy_matches:
            return fuzzy_matches[0]
        
        # Recherche par composants
        component_matches = self._search_by_components(query)
        return component_matches
    
    def check_interactions(self, medications):
        """Vérification des interactions médicamenteuses"""
        interactions = []
        
        for i, med1 in enumerate(medications):
            for med2 in medications[i+1:]:
                interaction = self._check_pair_interaction(med1, med2)
                if interaction:
                    interactions.append(interaction)
        
        return interactions
```

---

## 🗄️ Base de données et schéma

### Modèles de données

#### Prescription
```python
class Prescription(models.Model):
    STATUS_CHOICES = [
        ('uploaded', 'Uploadée'),
        ('analyzing', 'Analyse en cours'),
        ('confirmation_pending', 'Confirmation en attente'),
        ('confirmed', 'Confirmée'),
        ('searching', 'Recherche pharmacies'),
        ('pharmacy_selected', 'Pharmacie sélectionnée'),
        ('preparing', 'En préparation'),
        ('ready', 'Prête'),
        ('served', 'Servie'),
        ('patient_confirmed', 'Confirmée patient'),
        ('completed', 'Terminée'),
        ('cancelled', 'Annulée'),
        ('error', 'Erreur'),
    ]
    
    id = models.UUIDField(primary_key=True, default=uuid.uuid4)
    patient = models.ForeignKey(User, on_delete=models.CASCADE, related_name='prescriptions')
    image = models.ImageField(upload_to='prescriptions/')
    ocr_text = models.TextField(blank=True)
    confidence_score = models.FloatField(default=0.0)
    status = models.CharField(max_length=50, choices=STATUS_CHOICES, default='uploaded')
    medications = models.JSONField(default=list)
    selected_pharmacy = models.ForeignKey(Pharmacy, on_delete=models.SET_NULL, null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)
    served_at = models.DateTimeField(null=True, blank=True)
    patient_confirmed_at = models.DateTimeField(null=True, blank=True)
    total_amount = models.DecimalField(max_digits=10, decimal_places=2, null=True, blank=True)
    notes = models.TextField(blank=True)
```

#### MedicationExtraction
```python
class MedicationExtraction(models.Model):
    prescription = models.ForeignKey(Prescription, on_delete=models.CASCADE, related_name='extracted_medications')
    name = models.CharField(max_length=255)
    generic_name = models.CharField(max_length=255, blank=True)
    dosage = models.CharField(max_length=100, blank=True)
    quantity = models.IntegerField()
    unit = models.CharField(max_length=50, default='comprimés')
    confidence = models.FloatField(default=0.0)
    confirmed = models.BooleanField(default=False)
    alternatives = models.JSONField(default=list)
    requires_prescription = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)
```

#### PharmacyStock
```python
class PharmacyStock(models.Model):
    pharmacy = models.ForeignKey(Pharmacy, on_delete=models.CASCADE, related_name='stock')
    medication_name = models.CharField(max_length=255)
    generic_name = models.CharField(max_length=255, blank=True)
    dosage = models.CharField(max_length=100, blank=True)
    quantity = models.IntegerField(default=0)
    unit = models.CharField(max_length=50, default='comprimés')
    price = models.DecimalField(max_digits=10, decimal_places=2)
    last_updated = models.DateTimeField(auto_now=True)
    is_available = models.BooleanField(default=True)
```

#### PrescriptionStatusHistory
```python
class PrescriptionStatusHistory(models.Model):
    prescription = models.ForeignKey(Prescription, on_delete=models.CASCADE, related_name='status_history')
    status = models.CharField(max_length=50)
    changed_by = models.ForeignKey(User, on_delete=models.SET_NULL, null=True)
    changed_at = models.DateTimeField(auto_now_add=True)
    notes = models.TextField(blank=True)
```

---

## 🔌 API specifications

### Endpoints principaux

#### Upload d'ordonnance
```
POST /api/prescriptions/upload/
Content-Type: multipart/form-data

Request:
{
  "image": File,
  "patient_id": UUID
}

Response:
{
  "prescription_id": UUID,
  "status": "analyzing",
  "message": "Analyse en cours"
}
```

#### Analyse OCR
```
POST /api/prescriptions/{id}/analyze/
Response:
{
  "prescription_id": UUID,
  "ocr_text": string,
  "confidence_score": float,
  "medications": [
    {
      "name": string,
      "generic_name": string,
      "dosage": string,
      "quantity": integer,
      "confidence": float
    }
  ],
  "status": "confirmation_pending"
}
```

#### Confirmation des médicaments
```
POST /api/prescriptions/{id}/confirm/
Request:
{
  "medications": [
    {
      "id": UUID,
      "confirmed": boolean,
      "corrected_name": string (optional)
    }
  ]
}

Response:
{
  "prescription_id": UUID,
  "status": "confirmed",
  "medications": Medication[]
}
```

#### Recherche de pharmacies
```
GET /api/prescriptions/{id}/pharmacies/
Query parameters:
- latitude: float
- longitude: float
- radius: float (km)

Response:
{
  "prescription_id": UUID,
  "pharmacies": [
    {
      "pharmacy_id": UUID,
      "name": string,
      "address": string,
      "distance": float,
      "available_medications": Medication[],
      "missing_medications": Medication[],
      "match_score": float,
      "estimated_price": float,
      "estimated_time": int (minutes)
    }
  ]
}
```

#### Sélection de pharmacie
```
POST /api/prescriptions/{id}/select-pharmacy/
Request:
{
  "pharmacy_id": UUID
}

Response:
{
  "prescription_id": UUID,
  "selected_pharmacy": Pharmacy,
  "status": "pharmacy_selected",
  "estimated_arrival": DateTime
}
```

#### Confirmation pharmacie
```
POST /api/prescriptions/{id}/pharmacy-confirm/
Request:
{
  "served_by": string,
  "total_amount": float,
  "payment_method": string,
  "notes": string (optional)
}

Response:
{
  "prescription_id": UUID,
  "status": "served",
  "served_at": DateTime
}
```

#### Confirmation patient
```
POST /api/prescriptions/{id}/patient-confirm/
Request:
{
  "confirmed": boolean,
  "issue": string (optional)
}

Response:
{
  "prescription_id": UUID,
  "status": "completed",
  "confirmed_at": DateTime
}
```

---

## 🎨 Interface utilisateur

### Interface Chatbot

#### Composant Chatbot
```tsx
const PharmiGoChatbot = () => {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [currentStep, setCurrentStep] = useState<ChatStep>('welcome');
  const [prescriptionData, setPrescriptionData] = useState<PrescriptionData | null>(null);
  
  const steps = {
    welcome: {
      message: "👋 Bonjour ! Je suis votre assistant PharmiGo intelligent...",
      actions: [
        { label: "📸 Prendre une photo", action: "camera" },
        { label: "📁 Uploader une image", action: "upload" }
      ]
    },
    upload: {
      message: "Veuillez uploader votre ordonnance...",
      component: <ImageUpload onUpload={handleImageUpload} />
    },
    analyzing: {
      message: "🔍 Analyse de votre ordonnance en cours...",
      loading: true
    },
    confirmation: {
      message: "J'ai identifié les médicaments suivants. Confirmez-les :",
      component: <MedicationConfirmation medications={medications} />
    },
    pharmacy_search: {
      message: "🔍 Recherche des pharmacies disponibles...",
      loading: true
    },
    pharmacy_selection: {
      message: "Voici les pharmacies qui ont vos médicaments :",
      component: <PharmacyList pharmacies={pharmacies} />
    },
    completed: {
      message: "✅ Votre ordonnance a été servie avec succès !",
      actions: [
        { label: "🔄 Nouvelle ordonnance", action: "restart" }
      ]
    }
  };
  
  return (
    <ChatbotInterface>
      <MessageList messages={messages} />
      <CurrentStep step={steps[currentStep]} />
      <InputArea onSend={handleMessage} />
    </ChatbotInterface>
  );
};
```

### Interface de confirmation des médicaments

```tsx
const MedicationConfirmation = ({ medications, onConfirm, onEdit }) => {
  return (
    <ConfirmationPanel>
      <Header>
        <h2>🔍 Confirmation des médicaments</h2>
        <p>Vérifiez que les informations sont correctes</p>
      </Header>
      
      <MedicationList>
        {medications.map(med => (
          <MedicationItem key={med.id}>
            <MedicationInfo>
              <MedicationName>{med.name}</MedicationName>
              <MedicationDetails>
                <Dosage>{med.dosage}</Dosage>
                <Quantity>{med.quantity} {med.unit}</Quantity>
              </MedicationDetails>
              <ConfidenceBadge>
                Confiance : {(med.confidence * 100).toFixed(0)}%
              </ConfidenceBadge>
            </MedicationInfo>
            
            <Actions>
              <ConfirmButton onClick={() => onConfirm(med.id)}>
                ✅ Correct
              </ConfirmButton>
              <EditButton onClick={() => onEdit(med.id)}>
                ✏️ Modifier
              </EditButton>
            </Actions>
          </MedicationItem>
        ))}
      </MedicationList>
      
      <GlobalActions>
        <Button onClick={() => onConfirmAll()} variant="success">
          ✅ Tout confirmer
        </Button>
        <Button onClick={() => onReupload()} variant="secondary">
          🔄 Re-uploader
        </Button>
      </GlobalActions>
    </ConfirmationPanel>
  );
};
```

---

## ⚡ Exigences temps réel et fiabilité opérationnelle

### Objectif global
L'objectif de PharmiGo est que tout le parcours soit perçu comme instantané, cohérent et synchronisé. L'enregistrement, la connexion, la synchronisation des statuts, les dashboards et le chatbot doivent fonctionner en temps réel ou quasi temps réel.

### Exigences temps réel par domaine

#### 1. Authentification et session
- La connexion réussie doit être confirmée immédiatement côté interface
- Les rôles utilisateur doivent charger sans incohérence entre patient, pharmacien et administrateur
- La reconnexion automatique doit restaurer l'état actif si la session est encore valide

#### 2. Upload et enregistrement d'ordonnance
- L'enregistrement réussi doit être affiché immédiatement
- Le statut `uploaded` puis `analyzing` doit être propagé sans rechargement
- L'image et les métadonnées doivent être persistées avant de lancer l'analyse

#### 3. Réponses du chatbot
- Le chatbot doit répondre rapidement et de manière contextualisée
- Les messages doivent se mettre à jour en streaming ou par rafraîchissement instantané
- L'utilisateur doit toujours voir un état clair : en attente, en analyse, confirmation requise, résultats disponibles

#### 4. Synchronisation des statuts
- Tout changement de statut doit déclencher un événement temps réel
- Les dashboards patient, pharmacie et admin doivent afficher la même vérité métier
- Aucun écran ne doit rester bloqué sur un ancien statut après une action validée

#### 5. Stocks pharmacies
- La recherche de disponibilité doit s'appuyer sur les stocks les plus récents
- Une mise à jour de stock importante doit pouvoir invalider ou reclasser une recommandation
- Si un stock change après la sélection d'une pharmacie, le système doit remonter une alerte claire

#### 6. Dashboards opérationnels
- Le dashboard patient doit suivre le cycle complet de l'ordonnance
- Le dashboard pharmacie doit recevoir les nouvelles demandes immédiatement
- Le dashboard admin doit centraliser les statuts, les erreurs, les délais et les anomalies

### Architecture recommandée pour le temps réel
- WebSocket ou Django Channels pour les notifications bidirectionnelles
- Redis pour la gestion des événements, du cache et des files temps réel
- Tâches asynchrones pour l'OCR et les traitements lourds
- Historisation des événements pour rejouer ou réparer une synchronisation manquée

### Événements temps réel à diffuser
- `prescription_uploaded`
- `prescription_analysis_started`
- `prescription_confirmation_required`
- `prescription_confirmed`
- `pharmacy_search_started`
- `pharmacy_results_ready`
- `pharmacy_selected`
- `pharmacy_preparing`
- `prescription_served`
- `patient_purchase_confirmed`
- `prescription_completed`

### Indicateurs de fiabilité à surveiller
- Temps moyen entre upload et début d'analyse
- Temps moyen de réponse du chatbot
- Temps moyen de synchronisation d'un changement de statut
- Taux d'échec de notifications temps réel
- Taux de divergence entre stock affiché et stock réel
- Taux de dashboards non synchronisés

---

## 🔒 Sécurité et confidentialité

### Protection des données médicales

1. **Chiffrement des données**
   - Chiffrement AES-256 pour les images d'ordonnances
   - Chiffrement TLS 1.3 pour les communications
   - Chiffrement des données sensibles en base de données

2. **Conformité RGPD**
   - Consentement explicite du patient
   - Droit à l'oubli et à la suppression
   - Minimisation des données collectées
   - Politique de rétention des données

3. **Authentification et autorisation**
   - Authentification JWT avec refresh tokens
   - Rôles et permissions granulaires
   - MFA pour les pharmaciens

4. **Audit et logging**
   - Traçabilité complète des actions
   - Logs immuables pour les modifications
   - Alertes pour comportements suspects

### Sécurité de l'IA

1. **Validation des résultats OCR**
   - Seuils de confiance minimaux
   - Validation humaine pour les cas douteux
   - Fallback sur OCR secondaire

2. **Protection contre les attaques**
   - Rate limiting sur les endpoints OCR
   - Validation des formats d'images
   - Sanitization des inputs

3. **Transparence**
   - Affichage des scores de confiance
   - Possibilité de correction manuelle
   - Explication des décisions de l'IA

---

## 📊 Monitoring et analytics

### KPIs à suivre

1. **Performance OCR**
   - Taux de reconnaissance correcte
   - Temps moyen d'analyse
   - Score de confiance moyen

2. **Expérience utilisateur**
   - Taux de confirmation des médicaments
   - Temps de sélection de pharmacie
   - Taux de complétion du workflow

3. **Performance business**
   - Nombre d'ordonnances traitées
   - Taux de succès de matching
   - Satisfaction patients/pharmaciens

---

## 🚀 Roadmap d'implémentation

### Phase 1 : Fondation (4 semaines)
- [ ] Configuration infrastructure
- [ ] Base de données et modèles
- [ ] API endpoints de base
- [ ] Interface de chatbot simple

### Phase 2 : OCR et IA (6 semaines)
- [ ] Intégration Google Vision API
- [ ] Configuration Tesseract OCR
- [ ] Pipeline NLP
- [ ] Base de données médicamenteuse

### Phase 3 : Workflow complet (4 semaines)
- [ ] Interface de confirmation
- [ ] Système de matching pharmacies
- [ ] Workflow de sélection
- [ ] Notifications en temps réel

### Phase 4 : Testing et déploiement (2 semaines)
- [ ] Tests unitaires et intégration
- [ ] Tests utilisateur
- [ ] Déploiement en production
- [ ] Monitoring et analytics

---

## 📝 Conclusion

Ce système de chatbot intelligent pour PharmiGo représente une innovation majeure dans l'accès aux médicaments au Burundi et en RDC. En combinant :

- **IA avancée** pour l'analyse d'ordonnances
- **OCR multi-moteurs** pour une fiabilité maximale
- **Workflow optimisé** pour une expérience fluide
- **Sécurité renforcée** pour la protection des données
- **Scalabilité** pour gérer la croissance

Le système permettra de réduire considérablement le temps d'accès aux médicaments tout en améliorant la précision et la satisfaction des utilisateurs.
