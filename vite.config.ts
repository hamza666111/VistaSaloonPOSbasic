import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig(({ mode }) => {
  const env=loadEnv(mode, process.cwd(), 'VITE_');
  const key=env.VITE_SUPABASE_ANON_KEY||'';
  let role='';
  try {role=JSON.parse(Buffer.from(key.split('.')[1]||'', 'base64url').toString()).role||'';} catch { /* Publishable keys are not JWTs. */ }
  if(key.startsWith('sb_secret_') || (role && role!=='anon')) throw new Error('VITE_SUPABASE_ANON_KEY must be a public anon/publishable key. Never build with a secret or service-role key.');
  return {
    plugins:[react()],
    server:{host:'127.0.0.1',port:5173},
    build:{sourcemap:false},
  };
});
