export function deriveCareCapabilities(dashboard = {}) {
  const membership = dashboard.current_membership || dashboard.active_membership || null;
  const explicit = dashboard.capabilities || {};
  const hasMembership = Boolean(membership);
  const canManageFromMembership = membership?.role === "admin" || membership?.can_manage === true;
  const canManageCare = hasMembership
    ? explicit.can_manage_care !== undefined
      ? explicit.can_manage_care === true
      : canManageFromMembership
    : true;
  const canCompleteMedication = explicit.can_complete_medication !== undefined
    ? explicit.can_complete_medication === true
    : canManageCare;

  return {
    hasMembership,
    canManageCare,
    canCompleteMedication: canManageCare && canCompleteMedication,
    readOnly: hasMembership && !canManageCare,
  };
}
