import { useCallback, useEffect, useState } from "react";
import {
  createBillingCheckout,
  createCareProfile,
  fetchGroups,
  regenerateInvite,
  removeMember,
  updateMembership,
} from "../services/api";
import { buildCollaboratorContact } from "../services/contact";
import { resetCareWedoSessionAndReturnHome } from "../services/liff";

const CARE_WEDO_LINE_URL = "https://lin.ee/xzbyyvf";
const GROUP_LIMITS = {
  maxCareProfiles: 4,
  maxPaidCollaborators: 5,
  maxMembersIncludingOwner: 6,
};
const GROUP_PRICING = {
  recipientMonthly: 30,
  collaboratorMonthly: 10,
  includedCareProfilesDuringBeta: 1,
};

function calculateGroupMonthlyEstimate({ careProfileCount = 1, collaboratorCount = 0 } = {}) {
  const recipientCount = Math.max(Number(careProfileCount) || 0, 1);
  const paidCollaboratorCount = Math.max(Number(collaboratorCount) || 0, 0);
  const chargeableRecipientCount = Math.max(recipientCount - GROUP_PRICING.includedCareProfilesDuringBeta, 0);
  const recipientSubtotal = chargeableRecipientCount * GROUP_PRICING.recipientMonthly;
  const collaboratorSubtotal = paidCollaboratorCount * GROUP_PRICING.collaboratorMonthly;

  return {
    recipientCount,
    chargeableRecipientCount,
    paidCollaboratorCount,
    recipientSubtotal,
    collaboratorSubtotal,
    total: recipientSubtotal + collaboratorSubtotal,
  };
}

function submitGatewayCheckout(checkout) {
  if (!checkout?.action || !checkout?.fields) {
    throw new Error("付款表單資料不完整，請稍後再試。");
  }
  const actionUrl = new URL(checkout.action);
  if (actionUrl.protocol !== "https:") {
    throw new Error("付款網址格式不安全，已停止送出。");
  }
  const form = document.createElement("form");
  form.method = String(checkout.method || "POST").toUpperCase();
  form.action = actionUrl.toString();
  form.style.display = "none";
  Object.entries(checkout.fields).forEach(([name, value]) => {
    if (value === undefined || value === null) return;
    const input = document.createElement("input");
    input.type = "hidden";
    input.name = name;
    input.value = String(value);
    form.appendChild(input);
  });
  document.body.appendChild(form);
  form.submit();
}

function getBillingLimitConfig(group) {
  const entitlement = group?.billing_entitlement || {};
  return {
    maxCareProfiles: Number.isFinite(entitlement.maxCareProfiles) ? entitlement.maxCareProfiles : GROUP_LIMITS.maxCareProfiles,
    maxPaidCollaborators: Number.isFinite(entitlement.maxPaidCollaborators) ? entitlement.maxPaidCollaborators : GROUP_LIMITS.maxPaidCollaborators,
    maxMembersIncludingOwner: Number.isFinite(entitlement.maxMembersIncludingOwner)
      ? entitlement.maxMembersIncludingOwner
      : GROUP_LIMITS.maxMembersIncludingOwner,
    canAddCareProfile: typeof entitlement.canAddCareProfile === "boolean" ? entitlement.canAddCareProfile : true,
    estimatedMonthlyAmount: Number.isFinite(entitlement.estimatedMonthlyAmount) ? entitlement.estimatedMonthlyAmount : null,
    paidMonthlyAmount: Number.isFinite(entitlement.paidMonthlyAmount) ? entitlement.paidMonthlyAmount : null,
    subscriptionStatus: entitlement.subscriptionStatus || null,
    careProfileCount: Number.isFinite(entitlement.careProfileCount) ? entitlement.careProfileCount : null,
    paidCollaboratorCount: Number.isFinite(entitlement.paidCollaboratorCount) ? entitlement.paidCollaboratorCount : null,
  };
}

function buildPaidActionPreview({ actionType, group, careProfileCount, collaboratorCount }) {
  const current = calculateGroupMonthlyEstimate({ careProfileCount, collaboratorCount });
  const billingLimits = getBillingLimitConfig(group);
  const next = calculateGroupMonthlyEstimate({
    careProfileCount: actionType === "create_profile" ? careProfileCount + 1 : careProfileCount,
    collaboratorCount: actionType === "invite_collaborator" ? collaboratorCount + 1 : collaboratorCount,
  });
  const coveredCurrentTotal = billingLimits.paidMonthlyAmount ?? billingLimits.estimatedMonthlyAmount ?? current.total;
  return {
    actionType,
    groupName: group?.name || "家庭群組",
    current: {
      ...current,
      total: coveredCurrentTotal,
    },
    next,
    delta: Math.max(next.total - coveredCurrentTotal, 0),
  };
}

function buildGroupBillingSummary({ group, careProfileCount, collaboratorCount }) {
  const billingConfig = getBillingLimitConfig(group);
  const fallback = calculateGroupMonthlyEstimate({ careProfileCount, collaboratorCount });
  const estimatedMonthlyAmount = billingConfig.estimatedMonthlyAmount ?? fallback.total;
  const paidMonthlyAmount = billingConfig.paidMonthlyAmount ?? 0;
  return {
    estimatedMonthlyAmount,
    paidMonthlyAmount,
    amountDue: Math.max(estimatedMonthlyAmount - paidMonthlyAmount, 0),
    subscriptionStatus: billingConfig.subscriptionStatus,
  };
}

function PaidActionConfirmationModal({ action, onCancel, onConfirm, submitting = false }) {
  if (!action) return null;

  if (action.type === "limit_reached") {
    const limits = getBillingLimitConfig(action.group || null);
    return (
      <div className="modal-overlay paid-action-modal-overlay" onClick={onCancel}>
        <div className="modal-content paid-action-modal" role="dialog" aria-modal="true" aria-labelledby="paid-action-limit-title" onClick={(event) => event.stopPropagation()}>
          <div className="modal-header">
            <div>
              <p className="modal-kicker">單一家庭群組上限</p>
              <h2 id="paid-action-limit-title">{action.title}</h2>
            </div>
            <button type="button" className="btn-close" onClick={onCancel} aria-label="關閉">×</button>
          </div>
          <div className="modal-body">
            <p className="helper-copy">{action.message}</p>
            <div className="limit-summary-grid">
              <span>主要照護對象 {limits.maxCareProfiles} 位</span>
              <span>共同協作者 {limits.maxPaidCollaborators} 位</span>
              <span>主帳號 1 位不計費</span>
            </div>
            <p className="quota-note quota-note-warning">超過這個，請用其他協作者帳號，另外開設家庭群組。</p>
            <div className="paid-action-buttons">
              <button type="button" className="primary-action" onClick={onCancel}>我知道了</button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  const isProfileAction = action.preview.actionType === "create_profile";
  const title = isProfileAction ? "新增主要照護對象" : "邀請共同協作者";
  const deltaLabel = action.preview.delta > 0 ? `+$${action.preview.delta}/月` : "$0";
  const requiresCheckout = action.preview.delta > 0;
  const feeChangeCopy = isProfileAction
    ? `這個動作會讓「${action.preview.groupName}」月費從 $${action.preview.current.total} 變成 $${action.preview.next.total}。`
    : `若協作者完成加入，「${action.preview.groupName}」月費會從 $${action.preview.current.total} 變成 $${action.preview.next.total}。`;

  return (
    <div className="modal-overlay paid-action-modal-overlay" onClick={onCancel}>
      <div className="modal-content paid-action-modal" role="dialog" aria-modal="true" aria-labelledby="paid-action-title" onClick={(event) => event.stopPropagation()}>
        <div className="modal-header">
          <div>
              <p className="modal-kicker">測試期優惠與付款確認</p>
            <h2 id="paid-action-title">{title}</h2>
          </div>
          <button type="button" className="btn-close" onClick={onCancel} aria-label="關閉">×</button>
        </div>
        <div className="modal-body">
          <p className="helper-copy">
            第一位主要照護對象測試期減免 $30/月。{requiresCheckout ? "本次需要前往綠界安全付款。" : "本次仍在減免額度內，不需付款。"}{feeChangeCopy}
          </p>
          <div className="paid-action-total-row">
            <span>本次月費影響</span>
            <strong>{deltaLabel}</strong>
          </div>
          <div className="paid-action-breakdown" aria-label="增加後月費明細">
            <div>
              <span>主要照護對象</span>
              <strong>${GROUP_PRICING.recipientMonthly} x {action.preview.next.chargeableRecipientCount} 位</strong>
              <em>${action.preview.next.recipientSubtotal}</em>
            </div>
            {action.preview.next.recipientCount > 0 && (
              <div>
                <span>測試期減免</span>
                <strong>首位主要照護對象</strong>
                <em>$0</em>
              </div>
            )}
            {action.preview.next.paidCollaboratorCount > 0 && (
              <div>
                <span>共同協作者</span>
                <strong>${GROUP_PRICING.collaboratorMonthly} x {action.preview.next.paidCollaboratorCount} 位</strong>
                <em>${action.preview.next.collaboratorSubtotal}</em>
              </div>
            )}
          </div>
          <p className="quota-note">
            主帳號不列入協作者費用。付款頁由綠界提供，Care WEDO 不保存信用卡資料。
          </p>
          <div className="paid-action-buttons">
            <button type="button" className="primary-action" onClick={onConfirm} disabled={submitting}>
              {submitting ? "準備付款中..." : requiresCheckout ? "前往安全付款" : "我了解，繼續新增"}
            </button>
            <button type="button" className="secondary-action" onClick={onCancel} disabled={submitting}>先不要新增</button>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function GroupSettings({ identity, onGroupChange, onProfileCreated }) {
  const [data, setData] = useState({ groups: [], care_profiles: [], user_memberships: [] });
  const [selectedGroupId, setSelectedGroupId] = useState(null);
  const [displayName, setDisplayName] = useState("");
  const [relationship, setRelationship] = useState("family");
  const [error, setError] = useState(null);
  const [success, setSuccess] = useState(null);
  const [loading, setLoading] = useState(false);
  const [updatingGroupId, setUpdatingGroupId] = useState(null);
  const [copiedCode, setCopiedCode] = useState(null);
  const [pendingPaidAction, setPendingPaidAction] = useState(null);
  const [billingSubmitting, setBillingSubmitting] = useState(false);

  const loadGroups = useCallback(async () => {
    if (!identity || (identity.status !== "demo" && !identity.idToken)) return;
    try {
      const payload = await fetchGroups(identity);
      setData(payload);
      setError(null);
      if (!selectedGroupId && payload.groups?.length) {
        setSelectedGroupId(payload.groups[0].id);
      }
    } catch (err) {
      if (err.code === "AUTH_REQUIRED") {
        await resetCareWedoSessionAndReturnHome();
        return;
      }
      setError(err.message || "無法載入群組設定");
    }
  }, [identity, selectedGroupId]);

  useEffect(() => {
    if (!identity || identity.status === "loading") return;
    loadGroups();
  }, [identity, loadGroups]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const url = new URL(window.location.href);
    if (url.searchParams.get("billing") !== "return") return;
    setSuccess("付款結果正在同步中。若剛完成付款，請稍候重新整理照護圈設定。");
    url.searchParams.delete("billing");
    window.history.replaceState({}, "", `${url.pathname}${url.search}${url.hash}`);
  }, []);

  function getMembersByGroup(groupId) {
    return data.user_memberships?.filter((m) => m.group_id === groupId) || [];
  }

  function buildInviteMessage(group, code) {
    const inviteUrl = `${window.location.origin}/login?invite_code=${encodeURIComponent(code)}`;
    return `邀請你加入 Care WEDO「${group.name || "家庭群組"}」，一起照顧家人。\n\n邀請碼：${code}\n加入網址：${inviteUrl}\n\n打開網址後，用 LINE 登入並完成基本資料，就能同步看今日照護、未來行程與提醒。\n\n要收到家人上傳摘要與每日提醒，也請加入 LINE 照護小管家：\n${CARE_WEDO_LINE_URL}`;
  }

  function executeInviteCopy(group, copyMode = "full") {
    const message = buildInviteMessage(group, group.invite_code);
    navigator.clipboard.writeText(copyMode === "code" ? group.invite_code : message);
    setCopiedCode(group.invite_code);
    setTimeout(() => setCopiedCode(null), 2000);
  }

  function showLimitModal(kind, group) {
    const limits = getBillingLimitConfig(group);
    const title = kind === "collaborator"
      ? `已達 ${limits.maxPaidCollaborators} 位共同協作者上限`
      : `已達 ${limits.maxCareProfiles} 位主要照護對象上限`;
    const message = kind === "collaborator"
      ? `「${group?.name || "這個群組"}」已達 ${limits.maxPaidCollaborators} 位共同協作者上限。`
      : `「${group?.name || "這個群組"}」已達 ${limits.maxCareProfiles} 位主要照護對象上限。`;
    setPendingPaidAction({ type: "limit_reached", title, message });
  }

  function requestInviteConfirmation(group, copyMode = "full") {
    setError(null);
    setSuccess(null);
    if (isCollaboratorLimitReached(group)) {
      showLimitModal("collaborator", group);
      return;
    }
    setPendingPaidAction({
      type: "invite_collaborator",
      copyMode,
      groupId: group.id,
      group,
      preview: buildPaidActionPreview({
        actionType: "invite_collaborator",
        group,
        careProfileCount: group?.care_profile_count ?? 0,
        collaboratorCount: getCollaboratorCount(group),
      }),
    });
  }

  function getMemberContact(member, currentMembership) {
    if (isCurrentUserMember(member, currentMembership)) {
      return { type: "self", href: null, label: "目前登入者" };
    }
    const user = getMemberUser(member);
    return buildCollaboratorContact({
      lineUserId: user?.line_user_id,
      email: user?.email,
    });
  }

  function handleMemberContact(member, currentMembership) {
    const contact = getMemberContact(member, currentMembership);
    if (contact.type === "self") {
      setSuccess("這是你目前登入的協作者帳號。");
      return;
    }
    if (!contact.href) {
      setSuccess("這位協作者目前沒有可直接聯絡方式，請先請對方補上 Email 或可公開加入的 LINE ID。");
      return;
    }
    if (contact.type === "email") {
      window.location.assign(contact.href);
      return;
    }
    window.open(contact.href, "_blank", "noopener,noreferrer");
  }

  function getMemberUser(member) {
    return member.user || member.users || null;
  }

  function isCurrentUserMember(member, currentMembership) {
    return Boolean(currentMembership?.user_id && member.user_id === currentMembership.user_id);
  }

  function getMemberDisplayName(member, index, currentMembership) {
    const user = getMemberUser(member);
    if (isCurrentUserMember(member, currentMembership)) {
      return identity.profile?.displayName || user?.name || "目前使用者";
    }
    return user?.name || (user?.line_user_id ? `LINE 用戶 …${user.line_user_id.slice(-4)}` : `成員 ${index + 1}`);
  }

  function getMemberAvatar(member, name, currentMembership) {
    const user = getMemberUser(member);
    const pictureUrl = isCurrentUserMember(member, currentMembership)
      ? identity.profile?.pictureUrl || user?.picture_url
      : user?.picture_url;
    return pictureUrl || `https://ui-avatars.com/api/?name=${encodeURIComponent(name)}&background=E6F0F1&color=315F68&bold=true`;
  }

  const selectedGroup = data.groups?.find((group) => group.id === selectedGroupId) || null;
  const selectedGroupPlan = selectedGroup?.plan || null;
  const selectedGroupBillingConfig = getBillingLimitConfig(selectedGroup);
  const selectedCareProfileCount = (selectedGroupBillingConfig.careProfileCount ?? selectedGroup?.care_profile_count
    ?? data.care_profiles?.filter((profile) => profile.group_id === selectedGroupId).length
    ?? 0);
  const selectedRecipientLimit = selectedGroupBillingConfig.maxCareProfiles;
  const selectedRecipientLimitReached = Boolean(
    selectedRecipientLimit && selectedCareProfileCount >= selectedRecipientLimit,
  );


  function getCollaboratorCount(group) {
    const members = group?.members || getMembersByGroup(group?.id);
    const billingConfig = getBillingLimitConfig(group);
    if (Number.isFinite(billingConfig.paidCollaboratorCount)) {
      return Math.max(billingConfig.paidCollaboratorCount, 0);
    }
    return Math.max((group?.member_count ?? members.length) - 1, 0);
  }

  function isCollaboratorLimitReached(group) {
    const members = group?.members || getMembersByGroup(group?.id);
    const memberCount = group?.member_count ?? members.length;
    const billingConfig = getBillingLimitConfig(group);
    return memberCount >= billingConfig.maxMembersIncludingOwner || getCollaboratorCount(group) >= billingConfig.maxPaidCollaborators;
  }

  async function submitCreateProfile({ groupId, profileName, profileRelationship }) {
    setLoading(true);
    try {
      await createCareProfile({
        idToken: identity.idToken,
        groupId,
        displayName: profileName,
        relationship: profileRelationship,
      });
      setSuccess("已新增照護對象，畫面已更新。");
      setDisplayName("");
      if (onProfileCreated) onProfileCreated();
      await loadGroups();
    } catch (err) {
      if (err.code === "AUTH_REQUIRED") {
        await resetCareWedoSessionAndReturnHome();
        return;
      }
      setError(err.message || "建立照護對象失敗");
    } finally {
      setLoading(false);
    }
  }

  function requestProfileCreationConfirmation(event) {
    event.preventDefault();
    setError(null);
    setSuccess(null);

    const profileName = displayName.trim();
    if (!profileName) {
      setError("請輸入照護對象稱呼");
      return;
    }

    if (!selectedGroupId) {
      setError("請先加入或建立一個群組");
      return;
    }

    if (selectedRecipientLimitReached) {
      showLimitModal("profile", selectedGroup);
      return;
    }

    setPendingPaidAction({
      type: "create_profile",
      group: selectedGroup,
      profileName,
      profileRelationship: relationship,
      groupId: selectedGroupId,
      preview: buildPaidActionPreview({
        actionType: "create_profile",
        group: selectedGroup,
        careProfileCount: selectedCareProfileCount,
        collaboratorCount: getCollaboratorCount(selectedGroup),
      }),
    });
  }

  async function runConfirmedPaidAction() {
    const action = pendingPaidAction;
    if (!action || action.type === "limit_reached") return;
    if (action.preview.delta > 0) {
      setBillingSubmitting(true);
      try {
        const checkout = await createBillingCheckout({
          idToken: identity.idToken,
          groupId: action.groupId || action.group?.id,
          actionType: action.preview.actionType,
        });
        if (!checkout.checkout_required) {
          setPendingPaidAction(null);
          setBillingSubmitting(false);
          if (action.type === "invite_collaborator") {
            executeInviteCopy(action.group, action.copyMode);
            setSuccess("已複製邀請內容。");
            return;
          }
          if (action.type === "create_profile") {
            await submitCreateProfile({
              groupId: action.groupId,
              profileName: action.profileName,
              profileRelationship: action.profileRelationship,
            });
          }
          return;
        }
        submitGatewayCheckout(checkout.checkout);
      } catch (err) {
        setError(err.message || "無法建立付款連結");
        setBillingSubmitting(false);
      }
      return;
    }
    setPendingPaidAction(null);
    if (action.type === "invite_collaborator") {
      executeInviteCopy(action.group, action.copyMode);
      setSuccess("已複製邀請內容。");
      return;
    }
    if (action.type === "create_profile") {
      await submitCreateProfile({
        groupId: action.groupId,
        profileName: action.profileName,
        profileRelationship: action.profileRelationship,
      });
    }
  }

  async function handleGroupBillingCheckout(group) {
    if (!group?.id) return;
    setError(null);
    setSuccess(null);
    setBillingSubmitting(true);
    try {
      const checkout = await createBillingCheckout({
        idToken: identity.idToken,
        groupId: group.id,
        actionType: "settle_group",
      });
      if (!checkout.checkout_required) {
        setSuccess(checkout.message || "目前付款狀態已涵蓋這個家庭群組。");
        setBillingSubmitting(false);
        await loadGroups();
        return;
      }
      submitGatewayCheckout(checkout.checkout);
    } catch (err) {
      setError(err.message || "無法建立付款連結");
      setBillingSubmitting(false);
    }
  }

  async function handleToggle(groupId, field, checked) {
    setError(null);
    setSuccess(null);
    setUpdatingGroupId(groupId);
    try {
      await updateMembership({
        idToken: identity.idToken,
        groupId,
        updates: { [field]: checked },
      });
      setSuccess("通知設定已儲存。");
      if (onGroupChange) onGroupChange();
      await loadGroups();
    } catch (err) {
      if (err.code === "AUTH_REQUIRED") {
        await resetCareWedoSessionAndReturnHome();
        return;
      }
      setError(err.message || "更新通知設定失敗");
    } finally {
      setUpdatingGroupId(null);
    }
  }

  async function handleRemoveMember(groupId, targetUserId) {
    if (!window.confirm("確定要移除這位成員嗎？移除後他們將無法再查看此群組的資料。")) return;
    setError(null);
    setSuccess(null);
    try {
      await removeMember({ idToken: identity.idToken, groupId, targetUserId });
      setSuccess("成員已移除。");
      await loadGroups();
    } catch (err) {
      if (err.code === "AUTH_REQUIRED") {
        await resetCareWedoSessionAndReturnHome();
        return;
      }
      setError(err.message || "移除成員失敗");
    }
  }

  async function handleRegenerateInvite(groupId) {
    if (!window.confirm("確定要重新產生邀請碼嗎？舊的邀請碼將立即失效。")) return;
    setError(null);
    setSuccess(null);
    try {
      await regenerateInvite({ idToken: identity.idToken, groupId });
      setSuccess("邀請碼已更新。");
      await loadGroups();
    } catch (err) {
      if (err.code === "AUTH_REQUIRED") {
        await resetCareWedoSessionAndReturnHome();
        return;
      }
      setError(err.message || "重新產生邀請碼失敗");
    }
  }

  if (identity.status === "demo") {
    return (
      <div className="group-settings-card">
        <p className="panel-eyebrow">協作者管理中心</p>
        <p className="helper-copy">LINE 登入後才能管理群組通知與照護對象。</p>
      </div>
    );
  }

  return (
    <div className="group-settings">
      <div className="group-settings-card">
        <p className="panel-eyebrow">家庭群組管理</p>
        {error && <p className="error-msg">{error}</p>}
        {success && <p className="success-msg">{success}</p>}
        
        {data.groups?.length ? (
          data.groups.map((group) => {
            const membership = data.user_memberships?.find((m) => m.group_id === group.id);
            const isAdmin = membership?.role === "admin";
            // Use enriched members list from group if available, else fall back to memberships
            const members = group.members || getMembersByGroup(group.id);
            const careProfileCount = Number.isFinite(group?.billing_entitlement?.careProfileCount)
              ? group.billing_entitlement.careProfileCount
              : group.care_profile_count ?? 0;
            const collaboratorCount = getCollaboratorCount(group);
            const collaboratorLimitReached = isCollaboratorLimitReached(group);
            const groupBillingConfig = getBillingLimitConfig(group);
            const billingSummary = buildGroupBillingSummary({ group, careProfileCount, collaboratorCount });
            const canStartPayment = isAdmin || membership?.can_pay === true;
            return (
              <div key={group.id} className="settings-group-card">
                <div className="settings-group-header">
                  <div>
                    <strong>{group.name}</strong>
                    <p className="small-copy">{isAdmin ? "群組管理者" : "協作者"}・主帳號 1 位不計費</p>
                    <p className="small-copy">
                      主要照護對象 {careProfileCount}/{groupBillingConfig.maxCareProfiles}・協作者 {collaboratorCount}/{groupBillingConfig.maxPaidCollaborators}
                    </p>
                  </div>
                </div>

                <div className="group-billing-panel" aria-label={`${group.name} 費用與付款`}>
                  <div>
                    <p className="group-billing-label">費用與付款</p>
                    <strong>目前月費 ${billingSummary.estimatedMonthlyAmount}</strong>
                    <span>
                      已付款涵蓋 ${billingSummary.paidMonthlyAmount}
                      {billingSummary.subscriptionStatus === "checkout_pending" ? "・付款同步中" : ""}
                    </span>
                  </div>
                  <div className="group-billing-meta">
                    <span>照護對象 {careProfileCount}/{groupBillingConfig.maxCareProfiles}</span>
                    <span>協作者 {collaboratorCount}/{groupBillingConfig.maxPaidCollaborators}</span>
                    <span>首位照護對象測試期減免</span>
                  </div>
                  {billingSummary.amountDue > 0 ? (
                    canStartPayment ? (
                      <button
                        type="button"
                        className="group-billing-pay-button"
                        onClick={() => handleGroupBillingCheckout(group)}
                        disabled={billingSubmitting}
                      >
                        {billingSubmitting ? "準備付款中..." : `前往付款 $${billingSummary.amountDue}/月`}
                      </button>
                    ) : (
                      <p className="quota-note">請群組管理者或付款負責人處理付款。</p>
                    )
                  ) : (
                    <p className="quota-note">目前付款狀態已涵蓋這個群組。</p>
                  )}
                </div>

                <div className="group-invite-block">
                  <div className="invite-copy-head compact">
                    <span>邀請協作者</span>
                    <strong>{group.invite_code}</strong>
                  </div>
                  <p className="helper-copy">
                    {collaboratorLimitReached
                      ? `已達 ${groupBillingConfig.maxPaidCollaborators} 位協作者上限。超過這個，請用其他協作者帳號，另外開設家庭群組。`
                      : "複製邀請碼或完整邀請文，貼到 LINE 給協作者。"}
                  </p>
                  <div className="invite-code-row">
                    <button
                      type="button"
                      className="btn-copy"
                      onClick={() => requestInviteConfirmation(group, "full")}
                    >
                      {copiedCode === group.invite_code ? "已複製邀請文案" : "複製完整邀請"}
                    </button>
                    <button type="button" className="btn-secondary-sm" onClick={() => requestInviteConfirmation(group, "code")}>
                      只複製邀請碼
                    </button>
                    <a className="btn-secondary-sm invite-line-link" href={CARE_WEDO_LINE_URL} target="_blank" rel="noopener noreferrer">
                      加入 LINE 小管家
                    </a>
                    {isAdmin && (
                      <button
                        type="button"
                        className="btn-secondary-sm"
                        onClick={() => handleRegenerateInvite(group.id)}
                      >
                        重新產生
                      </button>
                    )}
                  </div>
                </div>

                <div className="members-list">
                  <label>照護協作者</label>
                  <div className="members-grid">
                    {members.map((m, idx) => {
                      const displayName = getMemberDisplayName(m, idx, membership);
                      const avatarUrl = getMemberAvatar(m, displayName, membership);
                      const contact = getMemberContact(m, membership);
                      const contactTitle = contact.type === "self"
                        ? "目前登入者"
                        : contact.href
                          ? `聯絡 ${displayName}`
                          : "請先補聯絡方式";
                      return (
                        <div key={m.user_id ?? idx} className="member-item member-avatar-item">
                          <button
                            type="button"
                            className="member-avatar-button"
                            onClick={() => handleMemberContact(m, membership)}
                            title={contactTitle}
                          >
                            <img src={avatarUrl} alt={`${displayName} 頭像`} />
                          </button>
                          <span className="member-label">{displayName}</span>
                          <span className={`member-contact-tag member-contact-tag-${contact.type}`}>{contact.label}</span>
                          {isAdmin && m.role !== "admin" && (
                            <button
                              type="button"
                              className="btn-danger-sm"
                              onClick={() => handleRemoveMember(group.id, m.user_id)}
                            >
                              移除
                            </button>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>

                <div className="settings-toggle-list">
                  <label>我的通知設定</label>
                  {[
                    { field: "receive_daily_brief", label: "今日行程提醒" },
                    { field: "receive_evening_alert", label: "晚間提醒" },
                    { field: "receive_upload_summary", label: "上傳摘要通知" },
                  ].map((item) => (
                    <label key={item.field} className="settings-toggle">
                      <span>{item.label}</span>
                      <input
                        type="checkbox"
                        checked={Boolean(membership?.[item.field])}
                        disabled={updatingGroupId === group.id}
                        onChange={(event) => handleToggle(group.id, item.field, event.target.checked)}
                      />
                    </label>
                  ))}
                </div>
              </div>
            );
          })
        ) : (
          <p className="helper-copy">目前還沒有群組成員資料。請先加入或建立群組。</p>
        )}
      </div>

      <div className="group-settings-card">
        <p className="panel-eyebrow">新增主要照護對象</p>
        <p className="helper-copy">這裡新增的是被照顧的人。每個家庭群組最多 {selectedRecipientLimit || GROUP_LIMITS.maxCareProfiles} 位；超過時請另外開設家庭群組。</p>
        {data.groups?.length ? (
          <form className="profile-create-form" onSubmit={requestProfileCreationConfirmation}>
            <label>
              目標群組
              <select value={selectedGroupId || ""} onChange={(event) => setSelectedGroupId(Number(event.target.value))}>
                {data.groups.map((group) => (
                  <option key={group.id} value={group.id}>{group.name}</option>
                ))}
              </select>
            </label>
            {selectedGroupPlan && (
              <p className={selectedRecipientLimitReached ? "quota-note quota-note-warning" : "quota-note"}>
                目前 {selectedCareProfileCount}/{selectedRecipientLimit} 位主要照護對象
                {selectedRecipientLimitReached ? "，已達此家庭群組上限。" : "。"}
              </p>
            )}
            <label>
              照護對象稱呼
              <input
                value={displayName}
                onChange={(event) => setDisplayName(event.target.value)}
                placeholder="例：家中長輩、主要照護對象"
              />
            </label>
            <label>
              關係描述
              <select value={relationship} onChange={(event) => setRelationship(event.target.value)}>
                <option value="family">家人</option>
                <option value="friend">朋友</option>
                <option value="self">自己</option>
              </select>
            </label>
            <button type="submit" className="btn-submit" disabled={loading}>
              {loading ? "儲存中..." : "新增照護對象"}
            </button>
          </form>
        ) : (
          <p className="helper-copy">請先建立或加入家人群組，再新增照護對象。</p>
        )}
      </div>
      <PaidActionConfirmationModal
        action={pendingPaidAction}
        onCancel={() => {
          setPendingPaidAction(null);
          setBillingSubmitting(false);
        }}
        onConfirm={runConfirmedPaidAction}
        submitting={billingSubmitting}
      />
    </div>
  );
}
