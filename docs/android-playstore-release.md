# PharmiGo Android Release Kit

## Objectif

Ce document complete `docs/twa-android.md` pour preparer la publication Play Store proprement, apres stabilisation de la PWA et du backend.

## Etat actuel du projet

PharmiGo dispose deja de:

- un `manifest.webmanifest`
- un `service worker`
- une installation PWA
- une documentation TWA Android de base

Cela signifie que la base Android web-to-app existe deja. La derniere etape avant publication consiste surtout a:

1. fixer le domaine final
2. fixer le `package name` Android
3. generer la cle de signature
4. publier `assetlinks.json`
5. construire le projet Bubblewrap/TWA
6. produire un `AAB` signe pour le Play Store

## Valeurs recommandees

### Domaine public

Choisir un domaine stable, par exemple:

- `https://www.pharmigo.com`

### Package Android

Conserver un identifiant definitif, par exemple:

- `com.pharmigo.app`

Ne plus le changer apres la premiere publication Store.

## Variables de production a verifier avant packaging

- `FRONTEND_APP_URL=https://www.pharmigo.com`
- `FRONTEND_URL=https://www.pharmigo.com`
- `VITE_API_BASE_URL=https://api.pharmigo.com/api`
- `VITE_API_ORIGIN=https://api.pharmigo.com`
- `VITE_WS_BASE_URL=wss://api.pharmigo.com`
- `ALLOWED_HOSTS=api.pharmigo.com,...`
- `CSRF_TRUSTED_ORIGINS=https://www.pharmigo.com,https://api.pharmigo.com`

## Pre-flight checklist

- le frontend build sans erreur
- le backend passe `manage.py check`
- la page d'accueil charge correctement
- l'installation PWA fonctionne
- l'authentification fonctionne
- les websockets fonctionnent
- le upload ordonnance fonctionne
- les documents proteges restent proteges

## Fichiers a preparer

Utiliser les templates suivants:

- `docs/templates/assetlinks.json.example`
- `docs/templates/bubblewrap-manifest.example.json`

## Processus recommande

### 1. Acheter et configurer le domaine

Exemple:

- `www.pharmigo.com` pour le frontend
- `api.pharmigo.com` pour le backend

### 2. Verifier la PWA en production

- `https://www.pharmigo.com/manifest.webmanifest`
- `https://www.pharmigo.com/sw.js`
- installer depuis Chrome Android

### 3. Generer la cle de signature Android

```bash
keytool -genkey -v -keystore pharmigo-upload-key.jks -alias pharmigo -keyalg RSA -keysize 2048 -validity 10000
```

### 4. Recuperer le SHA256

```bash
keytool -list -v -keystore pharmigo-upload-key.jks -alias pharmigo
```

### 5. Publier Digital Asset Links

Publier:

- `https://www.pharmigo.com/.well-known/assetlinks.json`

en partant du template fourni.

### 6. Initialiser Bubblewrap

```bash
npm install -g @bubblewrap/cli
bubblewrap init --manifest=https://www.pharmigo.com/manifest.webmanifest
```

### 7. Generer le wrapper Android

```bash
bubblewrap build
```

### 8. Ouvrir dans Android Studio

Verifier:

- nom application
- icones
- splash
- orientation
- signature
- package

### 9. Produire le bundle Play Store

Generer:

- `AAB` release signe

### 10. Preparer la fiche Play Store

- icone 512
- banniere
- screenshots telephone
- politique de confidentialite
- email support
- description courte
- description longue

## Tests Android minimum avant publication

- ouverture app depuis ecran d'accueil
- login patient
- login pharmacie
- login admin
- upload ordonnance
- notification temps reel
- chatbot
- deconnexion / reconnexion
- changement de theme
- affichage sur petit ecran Android

## Limites restantes avant publication

Le projet est pret pour une passe finale TWA, mais il faudra encore:

- fixer le domaine final reel
- fixer le package Android definitif
- ajouter le vrai `assetlinks.json` avec le bon SHA256
- construire et signer le `AAB`

Sans ces trois donnees finales, le projet ne peut pas etre publie proprement sur le Play Store, meme si la partie web est deja compatible.
