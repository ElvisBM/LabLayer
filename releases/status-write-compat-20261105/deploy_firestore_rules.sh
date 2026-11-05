#!/usr/bin/env bash
set -euo pipefail

PROJECT_ID="lablayer-493220"
DATABASE_ID="ai-studio-914d19ee-caef-46d9-9cf8-561cc915d716"
RELEASE_NAME="projects/${PROJECT_ID}/releases/cloud.firestore/${DATABASE_ID}"

TOKEN="$(gcloud auth print-access-token)"
CONTENT="$(jq -Rs . < firestore.rules)"
FINGERPRINT="$(openssl dgst -sha256 -binary firestore.rules | openssl base64 -A)"

RULESET_RESPONSE="$(curl -sS -X POST \
  -H "Authorization: Bearer ${TOKEN}" \
  -H "x-goog-user-project: ${PROJECT_ID}" \
  -H "Content-Type: application/json" \
  -d "{\"source\":{\"files\":[{\"name\":\"firestore.rules\",\"content\":${CONTENT},\"fingerprint\":\"${FINGERPRINT}\"}]}}" \
  "https://firebaserules.googleapis.com/v1/projects/${PROJECT_ID}/rulesets")"

RULESET_NAME="$(printf "%s" "${RULESET_RESPONSE}" | jq -r '.name // empty')"
if [[ -z "${RULESET_NAME}" ]]; then
  printf "%s\n" "${RULESET_RESPONSE}"
  exit 1
fi

PATCH_RESPONSE="$(curl -sS -X PATCH \
  -H "Authorization: Bearer ${TOKEN}" \
  -H "x-goog-user-project: ${PROJECT_ID}" \
  -H "Content-Type: application/json" \
  -d "{\"release\":{\"name\":\"${RELEASE_NAME}\",\"rulesetName\":\"${RULESET_NAME}\"},\"updateMask\":\"ruleset_name\"}" \
  "https://firebaserules.googleapis.com/v1/${RELEASE_NAME}?updateMask=ruleset_name")"

printf "%s" "${PATCH_RESPONSE}" | jq -r '{name, rulesetName}'
