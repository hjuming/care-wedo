import { useCallback, useEffect, useState } from "react";
import { createCareProfile, fetchGroups, updateMembership } from "../services/api";

export default function GroupSettings({ identity, onGroupChange, onProfileCreated }) {
  const [data, setData] = useState({ groups: [], care_profiles: [], user_memberships: [] });
  const [selectedGroupId, setSelectedGroupId] = useState(null);
  const [displayName, setDisplayName] = useState("");
  const [relationship, setRelationship] = useState("family");
  const [error, setError] = useState(null);
  const [success, setSuccess] = useState(null);
  const [loading, setLoading] = useState(false);
  const [updatingGroupId, setUpdatingGroupId] = useState(null);

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

  function getGroupById(groupId) {
    return data.groups.find((group) => group.id === groupId);
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
        <p className="panel-eyebrow">群組通知設定</p>
        {error && <p className="error-msg">{error}</p>}
        {success && <p className="success-msg">{success}</p>}
        {data.user_memberships?.length ? (
          data.user_memberships.map((membership) => {
            const group = getGroupById(membership.group_id);
            if (!group) return null;
            return (
              <div key={membership.group_id} className="settings-group-card">
                <div className="settings-group-header">
                  <div>
                    <strong>{group.name}</strong>
                    <p className="small-copy">{membership.role === "admin" ? "群組管理者" : "一般成員"}</p>
                  </div>
                  <span className="group-code">代號：{group.invite_code}</span>
                </div>
                <div className="settings-toggle-list">
                  {[
                    { field: "receive_daily_brief", label: "每日簡報" },
                    { field: "receive_evening_alert", label: "晚間提醒" },
                    { field: "receive_upload_summary", label: "上傳摘要通知" },
                  ].map((item) => (
                    <label key={item.field} className="settings-toggle">
                      <span>{item.label}</span>
                      <input
                        type="checkbox"
                        checked={Boolean(membership[item.field])}
                        disabled={updatingGroupId === membership.group_id}
                        onChange={(event) => handleToggle(membership.group_id, item.field, event.target.checked)}
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
                placeholder="例如：媽媽、阿公、哥哥"
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
