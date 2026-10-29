import { createRequire } from 'node:module';
createRequire(import.meta.url)('./sync-version.cjs');
await import('./build-audio.mjs');
