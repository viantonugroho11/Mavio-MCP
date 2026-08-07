// DI tokens for upstream-auth wiring. Kept in a leaf module (no imports) so
// that controllers/services and upstream-auth.module can both depend on the
// tokens without forming an import cycle (which caused a TDZ ReferenceError
// at module load).
export const UPSTREAM_PROVIDERS = Symbol("UPSTREAM_PROVIDERS");
export const UPSTREAM_TOKEN_SERVICE = Symbol("UPSTREAM_TOKEN_SERVICE");
export const UPSTREAM_CREDS_REPO = Symbol("UPSTREAM_CREDS_REPO");
