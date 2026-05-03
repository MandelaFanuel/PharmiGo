# PharmiGo

PharmiGo est une plateforme de recherche de medicaments pour la RDC et le Burundi.
Elle permet a un patient de diffuser une ordonnance en temps reel, de recevoir des
reponses de pharmacies, de discuter avec elles, puis de suivre l'avancement de sa demande.

## Ce qui est inclus

- Backend `Django + DRF + Channels`
- Frontend `React + TypeScript + Vite`
- Theme `light/dark/system`
- Traduction `fr`, `en`, `rn`, `sw`, `ln`
- Docker Compose
- Environnement virtuel local `pharma`
- Endpoints centralises dans [backend/pharmigo/api.py](/home/fanuel045/MyProjects/PROJECTS/PharmiGo/backend/pharmigo/api.py)
- Endpoints frontend centralises dans [frontend/src/config/endpoints.ts](/home/fanuel045/MyProjects/PROJECTS/PharmiGo/frontend/src/config/endpoints.ts)

## Modules fonctionnels

- Dashboard patient et pharmacie
- Upload ordonnance
- Catalogue pharmacies
- Reponses pharmacies
- Chat avec support WebSocket
- Notifications
- KPIs et workflow

## Lancement local

```bash
python3 -m venv pharma
source pharma/bin/activate
pharma/bin/pip install -r backend/requirements.txt
cd frontend && npm install && cd ..
cd backend && ../pharma/bin/python manage.py migrate
```

Backend :

```bash
cd backend
../pharma/bin/python manage.py runserver 0.0.0.0:8000
```

Frontend :

```bash
cd frontend
npm run dev
```

## Docker

```bash
docker compose up --build
```

## Deployment docs

- Production checklist: [docs/deployment.md](/home/fanuel045/MyProjects/PROJECTS/PharmiGo/docs/deployment.md)
- Android TWA guide: [docs/twa-android.md](/home/fanuel045/MyProjects/PROJECTS/PharmiGo/docs/twa-android.md)

## Endpoints principaux

- `GET /api/health/`
- `GET /api/app-config/`
- `GET /api/dashboard/`
- `GET /api/endpoints/`
- `GET,POST /api/pharmacies/`
- `GET,POST /api/prescriptions/`
- `GET,POST /api/prescription-responses/`
- `GET,POST /api/messages/`
- `GET,POST /api/notifications/`
