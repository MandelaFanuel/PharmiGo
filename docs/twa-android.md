# PharmiGo Android TWA Guide

## Goal

This guide explains how to package the deployed PharmiGo PWA as a Trusted Web Activity for Android.

## Prerequisites

- A production HTTPS domain for the frontend
- A working PWA:
  - valid `manifest.webmanifest`
  - service worker enabled
  - installable over HTTPS
- Android Studio installed
- Java installed
- Node.js installed
- `bubblewrap` available:
  - `npm install -g @bubblewrap/cli`

## Important constraints

- TWA only works with HTTPS origins you control
- The frontend domain must be stable before generating the Android package
- Digital Asset Links must be configured correctly
- Backend private prescription files remain protected by backend auth and are not made public by TWA

## Step 1: Validate the live PWA

Before packaging:

- Open the production site in Chrome on Android
- Confirm it is installable
- Confirm the manifest loads correctly
- Confirm `display: standalone` behavior is correct
- Confirm service worker registration succeeds
- Confirm medical document endpoints are not cached

## Step 2: Initialize Bubblewrap

Run from a separate Android packaging workspace:

```bash
bubblewrap init --manifest=https://your-frontend-domain.example/manifest.webmanifest
```

Provide:

- application name
- package id, for example:
  - `com.pharmigo.app`
- launcher name
- display mode
- theme colors
- orientation

## Step 3: Generate signing keys

If you do not already have Android signing keys:

```bash
keytool -genkey -v -keystore pharmigo-upload-key.jks -alias pharmigo -keyalg RSA -keysize 2048 -validity 10000
```

Keep this file safe. You will need the SHA256 fingerprint for asset links and Play Store uploads.

## Step 4: Configure Digital Asset Links

Get the SHA256 fingerprint:

```bash
keytool -list -v -keystore pharmigo-upload-key.jks -alias pharmigo
```

Publish `assetlinks.json` on the frontend domain:

- location:
  - `https://your-frontend-domain.example/.well-known/assetlinks.json`

Example:

```json
[
  {
    "relation": ["delegate_permission/common.handle_all_urls"],
    "target": {
      "namespace": "android_app",
      "package_name": "com.pharmigo.app",
      "sha256_cert_fingerprints": [
        "AA:BB:CC:DD:EE:FF:..."
      ]
    }
  }
]
```

## Step 5: Build the Android project

Inside the Bubblewrap project:

```bash
bubblewrap build
```

This generates the Android wrapper project and APK/AAB build configuration.

## Step 6: Open in Android Studio

- Open the generated Android project
- Confirm:
  - app name
  - icons
  - splash screen
  - package id
  - signing config

## Step 7: Test on device

Install on a real Android device and verify:

- app launches full-screen
- no browser chrome appears after trust is established
- login works with phone number + password
- admin login still works with email + password
- upload flow works
- dashboards refresh correctly
- realtime websocket actions still work
- protected prescription documents remain auth-protected

## Step 8: Build the release bundle

Use Android Studio or Gradle to generate:

- release APK for testing
- release AAB for Play Store

## Step 9: Play Store readiness checklist

- package id finalized
- privacy policy URL prepared
- app icons and screenshots prepared
- contact email prepared
- content rating completed
- data safety form completed

## PharmiGo-specific checklist

- Frontend origin in TWA matches `FRONTEND_APP_URL` behavior expectations
- PWA icons are the same branded assets used by the web app
- Password reset email links point back to the production frontend domain
- Service worker keeps static cache only
- Protected endpoints are not cached by the browser shell

## Recommended post-release checks

- Fresh install on Android
- Open from home screen
- Logout/login cycle
- Upload prescription and confirm analysis flow
- Select pharmacy and confirm realtime updates
- Reset password for an account that has a recovery email
