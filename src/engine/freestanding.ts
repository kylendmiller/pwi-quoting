// Freestanding crane (FSTR) = the crane builder with its own columns. Kept as its own entry point
// so older specs and imports keep working.
import { buildCrane, type CraneSpec, type BuildResult } from './crane';
import type { Catalog, Factors } from './kit';
export type { Catalog, Assumption } from './kit';
export type { BuildResult } from './crane';
export type FreestandingSpec = CraneSpec;
export function buildFreestanding(spec: FreestandingSpec, cat: Catalog, f: Factors = { production: 0.6, install: 1.02 }): BuildResult {
  return buildCrane({ ...spec, support: 'freestanding' }, cat, f);
}
