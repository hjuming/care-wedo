import { useState, useEffect, useCallback } from "react";
import { fetchGroups, createGroup, joinGroup } from "../services/api";
import { resetCareWedoSessionAndReturnHome } from "../services/liff";
import "./GroupManager.css";

export default function GroupManager({ identity, onGroupChange }) {
  const [groups, setGroups] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [showForm, setShowForm] = useState(false);
  const [action, setAction] = useState("join"); // 'join' or 'create'
  const [inputVal, setInputVal] = useState("");

  const loadGroups = useCallback(async () => {
    setLoading(true);
    try {
      const data = await fetchGroups({ idToken: identity.idToken });
      setGroups(data.groups || []);
      setError(null);
    } catch (err) {
      if (err.code === "AUTH_REQUIRED") {
        await resetCareWedoSessionAndReturnHome();
        return;
      }
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [identity.idToken]);

  useEffect(() => {
    if (identity.status === "loading") return;
    loadGroups();
  }, [identity.status, loadGroups]);

  async function handleSubmit(e) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      if (action === "create") {
        await createGroup({ idToken: identity.idToken, name: inputVal });
      } else {
        await joinGroup({ idToken: identity.idToken, code: inputVal });
      }
      setInputVal("");
      setShowForm(false);
      await loadGroups();
      if (onGroupChange) onGroupChange();
    } catch (err) {
      if (err.code === "AUTH_REQUIRED") {
        await resetCareWedoSessionAndReturnHome();
        return;
      }
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  if (identity.status === "demo") return null;

  return (
    <div className="group-manager-container">
      <div className="group-header">
        <h3>家人一起照顧</h3>
        <button className="btn-icon" onClick={() => setShowForm(!showForm)}>
          {showForm ? "✕" : "＋"}
        </button>
      </div>

      {error && <div className="error-msg">{error}</div>}

      {showForm ? (
        <form onSubmit={handleSubmit} className="group-form">
          <div className="tabs-mini">
            <button
              type="button"
              className={action === "join" ? "active" : ""}
              onClick={() => setAction("join")}
            >
              加入家人
            </button>
            <button
              type="button"
              className={action === "create" ? "active" : ""}
              onClick={() => setAction("create")}
            >
              建立家人群組
            </button>
          </div>
          <label htmlFor="group-action-value">
            {action === "join" ? "家人邀請碼" : "家人群組名稱"}
          </label>
          <input
            id="group-action-value"
            type="text"
            placeholder={action === "join" ? "輸入家人給您的 6 位邀請碼" : "例：我的家庭照護群組"}
            value={inputVal}
            onChange={(e) => setInputVal(e.target.value)}
            required
          />
          <button type="submit" disabled={loading} className="btn-submit">
            {loading ? "處理中..." : action === "join" ? "加入家人" : "建立小組"}
          </button>
        </form>
      ) : (
        <div className="groups-list">
          {groups.length === 0 ? (
            <p className="empty-text">還沒有加入家人小組</p>
          ) : (
            groups.map((g) => (
              <div key={g.id} className="group-item">
                <div className="group-info">
                  <span className="group-name">{g.name}</span>
                  <span className="group-code">邀請碼：{g.invite_code}</span>
                </div>
                <div className="group-tag">已加入</div>
              </div>
            ))
          )}
        </div>
      )}

    </div>
  );
}
