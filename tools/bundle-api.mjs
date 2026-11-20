// Builds the edge function in two parts:
//   app/public/engine/engine-<hash>.mjs  — the pricing engine (deployed with the Netlify site)
//   dist/quote-api/index.js              — the small server, importing the engine by URL
// Deploy Netlify FIRST, then deploy dist/quote-api/index.js to Supabase.
import { build } from 'esbuild';
import { createHash } from 'node:crypto';
import { mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
const SITE = process.env.SITE ?? 'https://pwi-quotes.netlify.app';
// IIFE that sets globalThis.PWIEngine — Supabase won't import modules by URL, so the function fetches
// this file at cold start, checks its SHA-256 against the pinned value, and evaluates it.
const eng = await build({ entryPoints: ['server/engine-entry.ts'], bundle: true, format: 'iife', globalName: 'PWIEngine', platform: 'neutral', minify: true, write: false });
const code = eng.outputFiles[0].text + '\nglobalThis.PWIEngine = PWIEngine;\n';
const sha = createHash('sha256').update(code).digest('hex'), hash = sha.slice(0, 10);
mkdirSync('app/public/engine', { recursive: true });
for (const f of readdirSync('app/public/engine')) rmSync(`app/public/engine/${f}`);
writeFileSync(`app/public/engine/engine-${hash}.js`, code);
const url = `${SITE}/engine/engine-${hash}.js`;
await build({ entryPoints: ['server/quote-api.ts'], bundle: true, format: 'esm', platform: 'neutral', minify: false, outfile: 'dist/quote-api/index.js',
  external: ['npm:*'], define: { __ENGINE_URL__: JSON.stringify(url), __ENGINE_SHA__: JSON.stringify(sha) } });
console.log('engine', url, code.length, 'bytes');
