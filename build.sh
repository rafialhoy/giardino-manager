#!/usr/bin/env bash
set -euo pipefail

: "${SUPABASE_URL:?Set SUPABASE_URL in Netlify env}"
: "${SUPABASE_ANON_KEY:?Set SUPABASE_ANON_KEY in Netlify env}"

# Optional gate envs (provide in Netlify for clarity)
GATE_MODE="${GATE_MODE:-supabase}"
MANAGER_EMAIL="${MANAGER_EMAIL:-manager@internal}"
PASS_HASH="${PASS_HASH:-}"

cat > env.js <<EOF
window.__ENV = {
  SUPABASE_URL: "${SUPABASE_URL}",
  SUPABASE_ANON_KEY: "${SUPABASE_ANON_KEY}",
  GATE_MODE: "${GATE_MODE}",
  MANAGER_EMAIL: "${MANAGER_EMAIL}",
  PASS_HASH: "${PASS_HASH}"
};
EOF

echo "env.js generated."
