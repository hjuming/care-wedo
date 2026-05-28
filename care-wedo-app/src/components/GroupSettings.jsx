import { useCallback, useEffect, useState } from "react";
import { createCareProfile, fetchGroups, regenerateInvite, removeMember, updateMembership } from "../services/api";
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
};

function calculateGroupMonthlyEstimate({ careProfileCount = 1, collaboratorCount = 0 } = {}) {
  const recipientCount = Math.max(Number(careProfileCount) || 0, 1);
  const paidCollaboratorCount = Math.max(Number(collaboratorCount) || 0, 0);
  const needsPaidCircle = recipientCount > 1 || paidCollaboratorCount > 0;
  const recipientSubtotal = needsPaidCircle ? recipientCount * GROUP_PRICING.recipientMonthly : 0;
  const collaboratorSubtotal = paidCollaboratorCount * GROUP_PRICING.collaboratorMonthly;

  return {
    recipientCount,
    paidCollaboratorCount,
    recipientSubtotal,
    collaboratorSubtotal,
    total: recipientSubtotal + collaboratorSubtotal,
  };
}

function buildPaidActionPreview({ actionType, group, careProfileCount, collaboratorCount }) {
  const current = calculateGroupMonthlyEstimate({ careProfileCount, collaboratorCount });
  const next = calculateGroupMonthlyEstimate({
    careProfileCount: actionType === "create_profile" ? careProfileCount + 1 : careProfileCount,
    collaboratorCount: actionType === "invite_collaborator" ? collaboratorCount + 1 : collaboratorCount,
  });
  return {
    actionType,
    groupName: group?.name || "家庭群組",
    current,
    next,
    delta: Math.max(next.total - current.total, 0),
  };
}

function PaidActionConfirmationModal({ action, onCancel, onConfirm }) {
  if (!action) return null;

  if (action.type === "limit_reached") {
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
              <span>主要照護對象 {GROUP_LIMITS.maxCareProfiles} 位</span>
              <span>共同協作者 {GROUP_LIMITS.maxPaidCollaborators} 位</span>
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
  const feeChangeCopy = isProfileAction
    ? `正式版這個動作會讓「${action.preview.groupName}」月費從 $${action.preview.current.total} 變成 $${action.preview.next.total}。`
    : `正式版若協作者完成加入，「${action.preview.groupName}」月費會從 $${action.preview.current.total} 變成 $${action.preview.next.total}。`;

  return (
    <div className="modal-overlay paid-action-modal-overlay" onClick={onCancel}>
      <div className="modal-content paid-action-modal" role="dialog" aria-modal="true" aria-labelledby="paid-action-title" onClick={(event) => event.stopPropagation()}>
        <div className="modal-header">
          <div>
            <p className="modal-kicker">Beta 費用確認</p>
            <h2 id="paid-action-title">{title}</h2>
          </div>
          <button type="button" className="btn-close" onClick={onCancel} aria-label="關閉">×</button>
        </div>
        <div className="modal-body">
          <p className="helper-copy">目前測試期間不會扣款。{feeChangeCopy}</p>
          <div className="paid-action-total-row">
            <span>本次月費影響</span>
            <strong>{deltaLabel}</strong>
          </div>
          <div className="paid-action-breakdown" aria-label="增加後月費明細">
            <div>
              <span>主要照護對象</span>
              <strong>${GROUP_PRICING.recipientMonthly} x {action.preview.next.recipientCount} 位</strong>
              <em>${action.preview.next.recipientSubtotal}</em>
            </div>
            {action.preview.next.paidCollaboratorCount > 0 && (
              <div>
                <span>共同協作者</span>
                <strong>${GROUP_PRICING.collaboratorMonthly} x {action.preview.next.paidCollaboratorCount} 位</strong>
                <em>${action.preview.next.collaboratorSubtotal}</em>
              </div>
            )}
          </div>
          <p className="quota-note">
            正式收費前會再次確認，不會靜默扣款。主帳號不列入協作者費用。
          </p>
          <div className="paid-action-buttons">
            <button type="button" className="primary-action" onClick={onConfirm}>我了解，繼續新增</button>
            <button type="button" className="secondary-action" onClick={onCancel}>先不要新增</button>
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
    const title = kind === "collaborator"
      ? "已達 5 位共同協作者上限"
      : "已達 4 位主要照護對象上限";
    const message = kind === "collaborator"
      ? `「${group?.name || "這個群組"}」已達共同協作者上限。`
      : `「${group?.name || "這個群組"}」已達主要照護對象上限。`;
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
      group,
      preview: buildPaidActionPreview({
        actionType: "invite_collaborator",
        group,
        careProfileCount: group?.care_profile_count ?? 0,
        collaboratorCount: getCollaboratorCount(group),
      }),
    });
  }

  function openLineProfile(lineUserId) {
    if (!lineUserId) return;
    const lineUrl = `https://line.me/R/ti/p/${encodeURIComponent(lineUserId)}`;
    window.open(lineUrl, "_blank", "noopener,noreferrer");
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
  const selectedCareProfileCount = selectedGroup?.care_profile_count
    ?? data.care_profiles?.filter((profile) => profile.group_id === selectedGroupId).length
    ?? 0;
  const selectedRecipientLimit = Math.min(selectedGroupPlan?.max_recipients || GROUP_LIMITS.maxCareProfiles, GROUP_LIMITS.maxCareProfiles);
  const selectedRecipientLimitReached = Boolean(
    selectedRecipientLimit && selectedCareProfileCount >= selectedRecipientLimit,
  );

  function getCollaboratorCount(group) {
    const members = group?.members || getMembersByGroup(group?.id);
    return Math.max((group?.member_count ?? members.length) - 1, 0);
  }

  function isCollaboratorLimitReached(group) {
    const members = group?.members || getMembersByGroup(group?.id);
    const memberCount = group?.member_count ?? members.length;
    return memberCount >= GROUP_LIMITS.maxMembersIncludingOwner || getCollaboratorCount(group) >= GROUP_LIMITS.maxPaidCollaborators;
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
    setPendingPaidAction(null);
    if (!action || action.type === "limit_reached") return;
    if (action.type === "invite_collaborator") {
      executeInviteCopy(action.group, action.copyMode);
      setSuccess("已複製邀請內容。正式版加入協作者前會再次確認費用。");
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
            const careProfileCount = group.care_profile_count ?? 0;
            const collaboratorCount = getCollaboratorCount(group);
            const collaboratorLimitReached = isCollaboratorLimitReached(group);
            return (
              <div key={group.id} className="settings-group-card">
                <div className="settings-group-header">
                  <div>
                    <strong>{group.name}</strong>
                    <p className="small-copy">{isAdmin ? "群組管理者" : "協作者"}・主帳號 1 位不計費</p>
                    <p className="small-copy">
                      主要照護對象 {careProfileCount}/{GROUP_LIMITS.maxCareProfiles}・協作者 {collaboratorCount}/{GROUP_LIMITS.maxPaidCollaborators}
                    </p>
                  </div>
                </div>

                <div className="group-invite-block">
                  <div className="invite-copy-head compact">
                    <span>邀請協作者</span>
                    <strong>{group.invite_code}</strong>
                  </div>
                  <p className="helper-copy">
                    {collaboratorLimitReached
                      ? "已達 5 位協作者上限。超過這個，請用其他協作者帳號，另外開設家庭群組。"
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
                      const memberUser = getMemberUser(m);
                      const displayName = getMemberDisplayName(m, idx, membership);
                      const avatarUrl = getMemberAvatar(m, displayName, membership);
                      return (
                        <div key={m.user_id ?? idx} className="member-item member-avatar-item">
                          <button
                            type="button"
                            className="member-avatar-button"
                            onClick={() => openLineProfile(memberUser?.line_user_id)}
                            title={memberUser?.line_user_id ? "開啟 LINE" : "尚未提供 LINE 連結"}
                          >
                            <img src={avatarUrl} alt={`${displayName} 頭像`} />
                          </button>
                          <span className="member-label">{displayName}</span>
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
                    { field: "receive_daily_brief", label: "每日簡報" },
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
        <p className="helper-copy">這裡新增的是被照顧的人。每個家庭群組最多 4 位；超過時請另外開設家庭群組。</p>
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
        onCancel={() => setPendingPaidAction(null)}
        onConfirm={runConfirmedPaidAction}
      />
    </div>
  );
}
