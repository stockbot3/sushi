#!/usr/bin/env bash
set -euo pipefail

echo "== Firebase Service Account (env) =="
if [[ -z "${FIREBASE_SERVICE_ACCOUNT:-}" ]]; then
  echo "FIREBASE_SERVICE_ACCOUNT is not set in this shell."
else
  echo "$FIREBASE_SERVICE_ACCOUNT" | python3 - <<'PY'
import json, sys
sa = json.load(sys.stdin)
print("project_id:", sa.get("project_id"))
print("client_email:", sa.get("client_email"))
print("storageBucket:", sa.get("storageBucket"))
if sa.get("project_id") and not sa.get("storageBucket"):
  print("bucket_guess:", f"{sa['project_id']}.appspot.com")
PY
fi

echo ""
echo "== Firebase CLI (if logged in) =="
if command -v firebase >/dev/null 2>&1; then
  firebase projects:list || true
else
  echo "firebase CLI not found"
fi
