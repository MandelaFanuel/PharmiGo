# PharmiGo API

Le point d'entree principal de l'API est :

- [backend/pharmigo/api.py](/home/fanuel045/MyProjects/PROJECTS/PharmiGo/backend/pharmigo/api.py)

## Endpoints exposes

- `GET /api/health/`
- `GET /api/app-config/`
- `GET /api/dashboard/`
- `GET /api/endpoints/`
- `GET,POST /api/users/`
- `GET,POST /api/pharmacies/`
- `GET,PUT,PATCH,DELETE /api/pharmacies/{id}/`
- `GET,POST /api/prescriptions/`
- `GET,PUT,PATCH,DELETE /api/prescriptions/{id}/`
- `GET,POST /api/prescription-responses/`
- `GET,POST /api/messages/`
- `GET,POST /api/notifications/`
- `WS /ws/chat/{room_name}/`

## Verification rapide

Les endpoints suivants ont ete verifies localement avec le client Django :

- `/api/health/`
- `/api/app-config/`
- `/api/dashboard/`
- `/api/endpoints/`
- `/api/pharmacies/`
- `/api/prescriptions/`
- `/api/prescription-responses/`
