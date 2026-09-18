export const PLANE_PRODUCT_VERSION = import.meta.env.VITE_APP_PRODUCT_VERSION;
export const PLANE_REVISION = import.meta.env.VITE_APP_REVISION;
export const PLANE_ENVIRONMENT = import.meta.env.VITE_APP_ENVIRONMENT;

/**
 * The human-facing build identifier.
 *
 * Leads with the product version, which is supplied to the build rather than
 * discovered here: this application is built from a repository that cannot see
 * the product's own VERSION file. The embedded upstream version is deliberately
 * absent — it is owned by the embedded manifest and inspectable there.
 *
 * Development is the only environment allowed to omit the product version,
 * because a fork-local development build has no product repository to read it
 * from. Preview and production builds fail rather than render a partial label.
 */
export const PLANE_BUILD_LABEL = PLANE_PRODUCT_VERSION
  ? `v${PLANE_PRODUCT_VERSION} (${PLANE_REVISION}) ${PLANE_ENVIRONMENT}`
  : `(${PLANE_REVISION}) ${PLANE_ENVIRONMENT}`;
