#!/usr/bin/env bash
set -euo pipefail

: "${SUPABASE_URL:?Set SUPABASE_URL in your host env}"
: "${SUPABASE_ANON_KEY:?Set SUPABASE_ANON_KEY in your host env}"

cat > env.js <<EOF
window.__ENV = {
  SUPABASE_URL: "${SUPABASE_URL}",
  SUPABASE_ANON_KEY: "${SUPABASE_ANON_KEY}"
};
EOF

echo "env.js generated."

chmod +x build.sh