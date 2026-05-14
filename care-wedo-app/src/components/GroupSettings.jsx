import { useCallback, useEffect, useState } from "react";
import { createCareProfile, fetchGroups, regenerateInvite, removeMember, updateMembership } from "../services/api";

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
    return `邀請你加入 Care WEDO「${group.name || "家庭群組"}」，一起照顧家人。\n\n邀請碼：${code}\n加入網址：${inviteUrl}\n\n打開網址後，用 LINE 登入並完成基本資料，就能同步看今日照護、未來行程與提醒。`;
  }

  function copyInviteCode(group) {
    const message = buildInviteMessage(group, group.invite_code);
    navigator.clipboard.writeText(message);
    setCopiedCode(group.invite_code);
    setTimeout(() => setCopiedCode(null), 2000);
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

  function copyInviteCodeOnly(code) {
    navigator.clipboard.writeText(code);
    setCopiedCode(code);
    setTimeout(() => setCopiedCode(null), 2000);
  }

  async function handleCreateProfile(event) {
    event.preventDefault();
    setError(null);
    setSuccess(null);

    if (!displayName.trim()) {
      setError("請輸入照護對象稱呼");
      return;
    }

    if (!selectedGroupId) {
      setError("請先加入或建立一個群組");
      return;
    }

    setLoading(true);
    try {
      await createCareProfile({
        idToken: identity.idToken,
        groupId: selectedGroupId,
        displayName: displayName.trim(),
        relationship,
      });
      setSuccess("已新增照護對象，畫面已更新。");
      setDisplayName("");
      if (onProfileCreated) onProfileCreated();
      await loadGroups();
    } catch (err) {
      setError(err.message || "建立照護對象失敗");
    } finally {
      setLoading(false);
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
      setError(err.message || "重新產生邀請碼失敗");
    }
  }

  if (identity.status === "demo") {
    return (
      <div className="group-settings-card">
        <p className="panel-eyebrow">群組與通知設定</p>
        <p className="helper-copy">LINE 登入後才能管理群組通知與照護對象。</p>
      </div>
    );
  }

  return (
    <div className="group-settings">
      <div className="group-settings-card">
        <p className="panel-eyebrow">我的家庭群組</p>
        {error && <p className="error-msg">{error}</p>}
        {success && <p className="success-msg">{success}</p>}
        
        {data.groups?.length ? (
          data.groups.map((group) => {
            const membership = data.user_memberships?.find((m) => m.group_id === group.id);
            const isAdmin = membership?.role === "admin";
            // Use enriched members list from group if available, else fall back to memberships
            const members = group.members || getMembersByGroup(group.id);
            return (
              <div key={group.id} className="settings-group-card">
                <div className="settings-group-header">
                  <div>
                    <strong>{group.name}</strong>
                    <p className="small-copy">
                      {isAdmin ? "👑 群組管理者" : "👨‍👩‍👧‍👦 成員"}・{members.length} 人
                    </p>
                  </div>
                </div>

                <div className="group-invite-block">
                  <label>邀請碼</label>
                  <div className="invite-code-row">
                    <code className="invite-code">{group.invite_code}</code>
                    <button
                      type="button"
                      className="btn-copy"
                      onClick={() => copyInviteCode(group)}
                    >
                      {copiedCode === group.invite_code ? "✓ 已複製邀請文案" : "複製邀請"}
                    </button>
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
                  <button type="button" className="btn-secondary-sm" onClick={() => copyInviteCodeOnly(group.invite_code)}>
                    只複製邀請碼
                  </button>
                  <p className="helper-copy">複製後可直接貼到 LINE 家庭群組。家人點網址登入後會自動帶入邀請碼。</p>
                </div>

                <div className="members-list">
                  <label>群組成員</label>
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
        <p className="panel-eyebrow">新增照護對象</p>
        {data.groups?.length ? (
          <form className="profile-create-form" onSubmit={handleCreateProfile}>
            <label>
              目標群組
              <select value={selectedGroupId || ""} onChange={(event) => setSelectedGroupId(Number(event.target.value))}>
                {data.groups.map((group) => (
                  <option key={group.id} value={group.id}>{group.name}</option>
                ))}
              </select>
            </label>
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
    </div>
  );
}
