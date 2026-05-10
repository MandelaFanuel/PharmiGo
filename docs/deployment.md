# PharmiGo Deployment Checklist

## Scope

This checklist is for a production deployment where:

- the frontend is hosted on Vercel or Netlify
- the Django backend is hosted on a server or container platform
- prescription source documents remain private on the backend side

Vercel and Netlify are suitable for the React frontend. They are not the right place to store private prescription files or run long-lived Django + Channels workloads by themselves.

## Recommended topology

- Frontend:
  - Vercel or Netlify
- Backend API:
  - VPS, Docker host, Render, Railway, or another Python-capable platform
- Database:
  - PostgreSQL in production
- Realtime:
  - Redis-backed Channels layer recommended in production
- Private files:
  - private storage mounted or managed on the backend side only

## Pre-deploy checks

- Backend checks pass:
  - `PHARMIGO_DEBUG=True ../pharma/bin/python backend/manage.py check`
  - `PHARMIGO_DEBUG=True ../pharma/bin/python backend/manage.py test apps.users.tests apps.prescriptions.tests apps.pharmacies.tests --verbosity 1 --parallel 1`
- Frontend checks pass:
  - `cd frontend && npm run lint`
  - `cd frontend && npm run typecheck`
  - `cd frontend && npm run build`
- Confirm `backend/venv` is not used anywhere
- Confirm `pharma` is the active local virtual environment

## Backend production checklist

### Environment variables

Set at minimum:

- `SECRET_KEY`
- `PHARMIGO_DEBUG=False`
- `ALLOWED_HOSTS`
- `CSRF_TRUSTED_ORIGINS`
- `DEFAULT_ADMIN_EMAIL`
- `DEFAULT_ADMIN_PASSWORD`
- `DEFAULT_ADMIN_USERNAME`
- `FRONTEND_APP_URL`
- `DEFAULT_FROM_EMAIL`
- `SMTP_HOST`
- `SMTP_PORT`
- `SMTP_USER`
- `SMTP_PASSWORD`
- `EMAIL_USE_TLS`
- `EMAIL_USE_SSL`
- `EMAIL_TIMEOUT`

Optional but recommended where applicable:

- `REDIS_HOST`
- `GEMINI_ENABLED`
- `GEMINI_API_KEY`
- `GEMINI_MODEL`
- `GOOGLE_VISION_ENABLED`
- `GOOGLE_APPLICATION_CREDENTIALS`

### Security

- Keep `PHARMIGO_DEBUG=False`
- Use strong `SECRET_KEY`
- Restrict `ALLOWED_HOSTS` to real domains only
- Set `CSRF_TRUSTED_ORIGINS` to the exact frontend HTTPS origins
- Serve backend over HTTPS only
- Do not expose `private_media` through nginx, CDN, or static file hosting
- Confirm `/api/prescriptions/<id>/document/` remains protected by backend authorization
- Confirm no public URL is generated for original prescription files

### Storage

- Mount persistent storage for:
  - `backend/media`
  - `backend/private_media`
- Restrict permissions on private storage
- Ensure backups for database and private media are encrypted and access-controlled

### Realtime

- Set `REDIS_HOST` in production
- Confirm websocket routing works behind your reverse proxy
- Forward websocket upgrade headers correctly

### Database

- Use PostgreSQL in production
- Run:
  - `../pharma/bin/python backend/manage.py migrate`
- Optionally run:
  - `../pharma/bin/python backend/manage.py createsuperuser`
  - only if you are not relying on the default admin bootstrap

### Email / password reset

- Password reset for standard users depends on an optional recovery email saved on the account
- Standard login remains:
  - phone number + password
- Admin login remains:
  - admin email + password
- For the current production setup, outbound email is expected to use DNSExit SMTP relay
- Confirm `EMAIL_FROM` and `DEFAULT_FROM_EMAIL` match the verified sender domain
- Validate outbound email before launch by testing:
  - password reset request
  - password reset confirmation
  - account signup email verification

## Frontend deployment checklist for Vercel

### Build settings

- Root directory:
  - `frontend`
- Install command:
  - `npm install`
- Build command:
  - `npm run build`
- Output directory:
  - `dist`

### Frontend environment variables

- `VITE_API_BASE_URL`
- `VITE_API_ORIGIN`
- `VITE_WS_BASE_URL`

Typical example:

- `VITE_API_BASE_URL=https://api.example.com/api`
- `VITE_API_ORIGIN=https://api.example.com`
- `VITE_WS_BASE_URL=wss://api.example.com`

### Vercel checks

- Confirm `manifest.webmanifest` is served
- Confirm `sw.js` is served
- Confirm generated PWA icons are reachable
- Confirm the service worker does not cache protected medical document endpoints
- Confirm login, registration, upload, dashboard, and realtime updates work against the production backend

## Frontend deployment checklist for Netlify

### Build settings

- Base directory:
  - `frontend`
- Build command:
  - `npm run build`
- Publish directory:
  - `frontend/dist`

### Frontend environment variables

- `VITE_API_BASE_URL`
- `VITE_API_ORIGIN`
- `VITE_WS_BASE_URL`

### Netlify checks

- Add SPA redirect rules if needed so client routes resolve to `index.html`
- Confirm `manifest.webmanifest`, `sw.js`, and icons are published
- Confirm HTTPS is active before enabling install flows widely

## Reverse proxy checklist

- Forward `/api/`
- Forward `/ws/`
- Keep websocket upgrade headers
- Do not serve `private_media` as a public static directory
- Cache static frontend assets only
- Do not cache authenticated API responses containing medical workflow data

## Final launch checklist

- Test patient registration with phone only
- Test patient registration with phone + optional email
- Test pharmacy registration with phone only
- Test admin login with email only
- Test forgot password with an account that has a recovery email
- Test forgot password with an unknown email and confirm generic response
- Test upload of image and PDF prescriptions
- Test patient confirmation flow
- Test pharmacy selection flow
- Test original document access only for patient, admin, and selected pharmacy
- Test service worker install and offline shell behavior
- Test mobile layout on Android and iPhone

## Recommended smoke tests after deployment

- `GET /api/health/`
- frontend homepage loads without console errors
- login works with a Burundi number:
  - `+257` + 8 digits
- login works with an RDC number:
  - `+243` + 9 digits
- login works with a Tanzania number:
  - `+255` + 9 digits
- websocket updates propagate on dashboard actions

### Persistent media storage

- `PHARMIGO_MEDIA_ROOT`

Recommended Render disk mount example:

- create a persistent disk mounted at `/var/data/pharmigo`
- set `PHARMIGO_MEDIA_ROOT=/var/data/pharmigo/media`

With this setup, public profile images remain available after redeploys and restarts.

### Public pharmacy image fallback

- `backend/media/pharmacies/` is intentionally versioned as a fallback for public pharmacy profile images
- `backend/private_media/` and prescription uploads must remain untracked
- if a production pharmacy still points to an older public image filename, the backend now also attempts a safe same-stem match in the public pharmacy image folder
