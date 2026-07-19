/**
 * Care WEDO 費用與人數上限的單一資料來源。
 *
 * 實際結帳、前端 fallback、靜態方案頁與 AIO 回歸測試都必須依照這份 contract。
 * 調整金額時不可只修改畫面文案。
 */
export const CARE_WEDO_PRICING = Object.freeze({
  currency_symbol: "$",
  recipient_monthly: 30,
  collaborator_monthly: 10,
  included_care_profiles_during_beta: 1,
  free_monthly_ocr_limit: 10,
  paid_monthly_ocr_limit: 100,
});

export const CARE_WEDO_GROUP_LIMITS = Object.freeze({
  max_care_profiles: 4,
  max_paid_collaborators: 5,
  max_members_including_owner: 6,
  monthly_price_max: 250,
});
