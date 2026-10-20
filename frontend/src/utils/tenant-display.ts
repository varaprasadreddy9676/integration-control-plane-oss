/**
 * Legal entity names in this product run long — "Acme Health (Harmony Institute
 * of Excellence in Reproductive Health)" — and the header rendered the whole
 * thing ellipsised directly beside a selector showing the same name ellipsised
 * at a different point. Two truncations of one string is noise, so the identity
 * line shows the short form and the full name stays on hover and in the
 * selector.
 *
 * Only a trailing parenthetical is dropped: "Apollo (North) Hospital" is a real
 * distinguishing name, not a legal suffix.
 */
export const shortTenantName = (name?: string | null): string | undefined => {
  if (!name) return undefined;
  const withoutParenthetical = name.replace(/\s*\([^)]*\)\s*$/, '').trim();
  return withoutParenthetical || name;
};
