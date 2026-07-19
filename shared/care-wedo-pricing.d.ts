export interface CareWedoPricingContract {
  readonly currency_symbol: string;
  readonly recipient_monthly: number;
  readonly collaborator_monthly: number;
  readonly included_care_profiles_during_beta: number;
  readonly free_monthly_ocr_limit: number;
  readonly paid_monthly_ocr_limit: number;
}

export interface CareWedoGroupLimitsContract {
  readonly max_care_profiles: number;
  readonly max_paid_collaborators: number;
  readonly max_members_including_owner: number;
  readonly monthly_price_max: number;
}

export const CARE_WEDO_PRICING: Readonly<CareWedoPricingContract>;
export const CARE_WEDO_GROUP_LIMITS: Readonly<CareWedoGroupLimitsContract>;
