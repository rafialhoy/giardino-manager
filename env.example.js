// Copy to env.js locally, or let build.sh generate at deploy.
window.__ENV = {
  SUPABASE_URL: "https://YOUR-PROJECT-REF.supabase.co",
  SUPABASE_ANON_KEY: "YOUR-PUBLIC-ANON-KEY",

  // Gate mode:
  // "supabase" -> sign in the fixed email below with the password users type
  // "hash"     -> no Supabase auth; compare SHA-256(password) to PASS_HASH
  GATE_MODE: "supabase",

  // Used when GATE_MODE="supabase"
  MANAGER_EMAIL: "manager@internal",

  // Used when GATE_MODE="hash" (hex SHA-256 of your chosen password)
  // Generate in browser console: 
  //    (async s=>{const e=new TextEncoder().encode(s),h=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',e))).map(b=>b.toString(16).padStart(2,'0')).join('');console.log(h)})('your-password')
  PASS_HASH: ""
};
