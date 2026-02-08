#!/bin/bash

# Configuration
PROJECT_ID=$(gcloud config get-value project)
REGION="us-central1"
RAW_BUCKET="petday-raw-videos-${PROJECT_ID}"
PROCESSED_BUCKET="petday-processed-highlights-${PROJECT_ID}"

echo "Using Project ID: $PROJECT_ID"

# Enable APIs
echo "Enabling necessary APIs..."
gcloud services enable \
  videointelligence.googleapis.com \
  aiplatform.googleapis.com \
  storage.googleapis.com \
  firestore.googleapis.com \
  run.googleapis.com \
  eventarc.googleapis.com \
  cloudbuild.googleapis.com

# Create GCS Buckets
echo "Creating GCS buckets..."
gsutil mb -l $REGION gs://$RAW_BUCKET
gsutil mb -l $REGION gs://$PROCESSED_BUCKET

# Set up Firestore (in native mode)
echo "Initializing Firestore..."
gcloud firestore databases create --region=$REGION --type=firestore-native

# Create necessary directories for the processor
mkdir -p ../processor

echo "Infrastructure setup script completed."
echo "RAW_BUCKET: $RAW_BUCKET"
echo "PROCESSED_BUCKET: $PROCESSED_BUCKET"
