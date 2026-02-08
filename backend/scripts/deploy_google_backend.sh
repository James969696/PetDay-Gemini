#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_DIR="$(cd "${SCRIPT_DIR}/../.." && pwd)"
cd "${REPO_DIR}"

PROJECT_ID="${PROJECT_ID:-}"
REGION="${REGION:-us-central1}"
SERVICE_NAME="${SERVICE_NAME:-petday-api}"
BUCKET_NAME="${BUCKET_NAME:-petday-media-${PROJECT_ID}}"
PUBLIC_BASE_URL_OVERRIDE="${PUBLIC_BASE_URL_OVERRIDE:-}"
MAX_INSTANCES="${MAX_INSTANCES:-3}"
MIN_INSTANCES="${MIN_INSTANCES:-1}"

if [[ -z "${PROJECT_ID}" ]]; then
  echo "ERROR: PROJECT_ID is required."
  echo "Example: PROJECT_ID=petday-prod GEMINI_API_KEY=xxxx ./backend/scripts/deploy_google_backend.sh"
  exit 1
fi

export HOME="${HOME_OVERRIDE:-/tmp/petday-home}"
export CLOUDSDK_CONFIG="${CLOUDSDK_CONFIG:-/tmp/gcloud-config}"
export XDG_CONFIG_HOME="${XDG_CONFIG_HOME:-/tmp/.config}"
mkdir -p "${HOME}" "${CLOUDSDK_CONFIG}" "${XDG_CONFIG_HOME}"

GCLOUD_BIN="${GCLOUD_BIN:-gcloud}"
if [[ -x /tmp/google-cloud-sdk/bin/gcloud ]]; then
  GCLOUD_BIN="/tmp/google-cloud-sdk/bin/gcloud"
fi

FIREBASE_BIN="${FIREBASE_BIN:-firebase}"
if ! command -v "${FIREBASE_BIN}" >/dev/null 2>&1 && [[ -x /tmp/firebase-tools/node_modules/.bin/firebase ]]; then
  FIREBASE_BIN="/tmp/firebase-tools/node_modules/.bin/firebase"
fi

if ! command -v "${GCLOUD_BIN}" >/dev/null 2>&1; then
  echo "ERROR: gcloud CLI is not installed."
  exit 1
fi
if ! command -v "${FIREBASE_BIN}" >/dev/null 2>&1; then
  echo "ERROR: firebase CLI is not installed."
  exit 1
fi

echo "[1/8] Setting active project..."
"${GCLOUD_BIN}" config set project "${PROJECT_ID}" >/dev/null

echo "[2/8] Enabling required Google APIs..."
"${GCLOUD_BIN}" services enable \
  run.googleapis.com \
  cloudbuild.googleapis.com \
  firestore.googleapis.com \
  storage.googleapis.com \
  secretmanager.googleapis.com \
  cloudtasks.googleapis.com

echo "[3/8] Creating Firestore database if missing..."
if ! "${GCLOUD_BIN}" firestore databases describe --database='(default)' >/dev/null 2>&1; then
  "${GCLOUD_BIN}" firestore databases create --location="${REGION}" --type=firestore-native
fi

echo "[4/8] Creating media bucket if missing..."
if ! "${GCLOUD_BIN}" storage buckets describe "gs://${BUCKET_NAME}" >/dev/null 2>&1; then
  "${GCLOUD_BIN}" storage buckets create "gs://${BUCKET_NAME}" --location="${REGION}" --uniform-bucket-level-access
fi

if [[ -n "${GEMINI_API_KEY:-}" ]]; then
  echo "[5/8] Ensuring Gemini API key secret exists..."
  if ! "${GCLOUD_BIN}" secrets describe GEMINI_API_KEY >/dev/null 2>&1; then
    printf "%s" "${GEMINI_API_KEY}" | "${GCLOUD_BIN}" secrets create GEMINI_API_KEY --data-file=-
  else
    printf "%s" "${GEMINI_API_KEY}" | "${GCLOUD_BIN}" secrets versions add GEMINI_API_KEY --data-file=-
  fi
else
  echo "[5/8] Skipping secret creation: GEMINI_API_KEY env not provided."
fi

echo "[6/8] Building backend image with Cloud Build..."
"${GCLOUD_BIN}" builds submit backend --tag "gcr.io/${PROJECT_ID}/${SERVICE_NAME}"

echo "[7/8] Deploying Cloud Run service..."
"${GCLOUD_BIN}" run deploy "${SERVICE_NAME}" \
  --image "gcr.io/${PROJECT_ID}/${SERVICE_NAME}" \
  --region "${REGION}" \
  --platform managed \
  --memory 4Gi \
  --cpu 2 \
  --concurrency 1 \
  --no-cpu-throttling \
  --timeout 3600 \
  --max-instances "${MAX_INSTANCES}" \
  --min-instances "${MIN_INSTANCES}" \
  --allow-unauthenticated \
  --set-env-vars "STORAGE_BUCKET=${BUCKET_NAME},UPLOAD_OBJECT_PREFIX=uploads/original,GENERATED_OBJECT_PREFIX=uploads/generated,MAX_UPLOAD_BYTES=21474836480,RESUMABLE_CHUNK_BYTES=8388608,FRIEND_PROCESSING_CONCURRENCY=3,GEMINI_UPLOAD_TIMEOUT_MS=240000,GEMINI_UPLOAD_ATTEMPTS=2,GEMINI_GETFILE_TIMEOUT_MS=20000,GEMINI_GETFILE_ATTEMPTS=2,GEMINI_GETFILE_POLL_MAX_RETRIES=60,GEMINI_GENERATE_TIMEOUT_MS=360000,GEMINI_GENERATE_ATTEMPTS=2,GEMINI_IMAGE_TIMEOUT_MS=45000,GEMINI_IMAGE_ATTEMPTS=2" \
  --set-secrets "GEMINI_API_KEY=GEMINI_API_KEY:latest"

SERVICE_URL="$("${GCLOUD_BIN}" run services describe "${SERVICE_NAME}" --region "${REGION}" --format='value(status.url)')"
FINAL_BASE_URL="${SERVICE_URL}"
if [[ -n "${PUBLIC_BASE_URL_OVERRIDE}" ]]; then
  FINAL_BASE_URL="${PUBLIC_BASE_URL_OVERRIDE}"
fi
"${GCLOUD_BIN}" run services update "${SERVICE_NAME}" --region "${REGION}" --update-env-vars "PUBLIC_BASE_URL=${FINAL_BASE_URL}"

echo "[8/8] Deploying Firebase hosting/rules/indexes..."
cp .firebaserc.example .firebaserc
PROJECT_ID="${PROJECT_ID}" node -e "const fs=require('fs');const p='.firebaserc';const o=JSON.parse(fs.readFileSync(p,'utf8'));o.projects={default:process.env.PROJECT_ID};fs.writeFileSync(p,JSON.stringify(o,null,2));"
"${FIREBASE_BIN}" use "${PROJECT_ID}"
set +e
FIREBASE_DEPLOY_OUTPUT="$("${FIREBASE_BIN}" deploy --only firestore:rules,firestore:indexes,storage,hosting 2>&1)"
FIREBASE_DEPLOY_STATUS=$?
set -e

if [[ ${FIREBASE_DEPLOY_STATUS} -eq 0 ]]; then
  echo "${FIREBASE_DEPLOY_OUTPUT}"
else
  echo "${FIREBASE_DEPLOY_OUTPUT}"
  if grep -q "Firebase Storage has not been set up" <<< "${FIREBASE_DEPLOY_OUTPUT}"; then
    echo "WARNING: Firebase Storage is not initialized for this project."
    echo "Deploying firestore + hosting only. Initialize Firebase Storage in console, then redeploy storage rules."
    "${FIREBASE_BIN}" deploy --only firestore:rules,firestore:indexes,hosting
  else
    echo "ERROR: Firebase deploy failed."
    exit "${FIREBASE_DEPLOY_STATUS}"
  fi
fi

echo "Deployment complete."
echo "Cloud Run URL: ${SERVICE_URL}"
echo "PUBLIC_BASE_URL: ${FINAL_BASE_URL}"
