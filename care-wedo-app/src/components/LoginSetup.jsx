import { useEffect, useRef, useState } from "react";
import aiAvatar from "../assets/ai-avatar.png";

export default function LoginSetup({ identity, onSetupComplete }) {
  const [step, setStep] = useState("check"); // check, setup, success, error
  const [retryToken, setRetryToken] = useState(0);
  const [familyName, setFamilyName] = useState("");
  const identityProfile = identity?.profile || {};
  const identityDisplayName = String(
    identityProfile.displayName
      || identityProfile.display_name
      || identityProfile.name
      || identityProfile.email
      || "照護對象",
  ).trim() || "照護對象";
  const identityPictureUrl = identityProfile.pictureUrl || identityProfile.picture_url || identityProfile.avatar_url || null;
  const [careName, setCareName] = useState(identityDisplayName);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const onSetupCompleteRef = useRef(onSetupComplete);
  const careNameEditedRef = useRef(false);

  useEffect(() => {
    onSetupCompleteRef.current = onSetupComplete;
  }, [onSetupComplete]);

  useEffect(() => {
    if (!careNameEditedRef.current) setCareName(identityDisplayName);
  }, [identityDisplayName]);

  useEffect(() => {
    let isMounted = true;
    async function checkFamily() {
      try {
        const res = await fetch("/api/me", {
          credentials: "same-origin",
          headers: identity.idToken ? { Authorization: `Bearer ${identity.idToken}` } : undefined,
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          throw new Error(data.error || "登入狀態確認失敗，請重新整理後再試一次。");
        }
        
        if (!isMounted) return;
        if (data.is_first_time) {
          setStep("setup");
        } else {
          setStep("done");
          if (onSetupCompleteRef.current) onSetupCompleteRef.current(data);
        }
      } catch (err) {
        if (!isMounted) return;
        setError(err.message || "登入狀態確認失敗，請重新整理後再試一次。");
        setStep("error");
      }
    }

    if (identity?.status === "authenticated" && step === "check") {
      checkFamily();
    }
    return () => {
      isMounted = false;
    };
  }, [identity?.status, identity?.idToken, retryToken, step]);

  async function handleSetup(e) {
    e.preventDefault();
    setLoading(true);
    setError(null);

    try {
      const res = await fetch("/api/me", {
        method: "POST",
        credentials: "same-origin",
        headers: {
          "Content-Type": "application/json",
          ...(identity.idToken ? { Authorization: `Bearer ${identity.idToken}` } : {}),
        },
        body: JSON.stringify({
          action: "init_family",
          family_name: familyName || `${careName} 的家庭`,
          primary_care_name: careName,
        }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "設定失敗");

      setStep("success");
      // onSetupComplete will be called when user clicks the button
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  if (!identity || identity.status !== "authenticated" || step === "done") {
    return null;
  }

  if (step === "check") {
    return (
      <div className="setup-overlay">
        <div className="setup-card">
          <p>正在檢查設定中...</p>
        </div>
      </div>
    );
  }

  if (step === "error") {
    return (
      <div className="setup-overlay">
        <div className="setup-card">
          <p className="panel-eyebrow">登入狀態確認</p>
          <h2>先幫你重新確認登入</h2>
          <p className="helper-copy">
            系統沒有確認到有效的登入狀態，所以先不進入設定流程，避免讓你重複綁定。
          </p>
          {error && <p className="error-msg">{error}</p>}
          <div className="setup-actions">
            <button
              type="button"
              className="primary-action"
              onClick={() => {
                setError(null);
                setStep("check");
                setRetryToken((value) => value + 1);
              }}
            >
              重新確認
            </button>
            <a className="secondary-action" href="/login">
              回到登入頁
            </a>
          </div>
        </div>
      </div>
    );
  }

  if (step === "success") {
    return (
      <div className="setup-overlay">
        <div className="setup-card">
          <p className="panel-eyebrow">✓ 設定完成</p>
          <strong>已建立家庭群組</strong>
          <p className="helper-copy">現在您可以邀請家人加入管理。</p>
          <button
            type="button"
            className="primary-action"
            onClick={() => {
              setStep("done");
              if (onSetupCompleteRef.current) onSetupCompleteRef.current();
            }}
          >
            進入應用
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="setup-overlay">
      <div className="setup-card">
        <p className="panel-eyebrow">歡迎使用 Care WEDO</p>
        <h2>先設定主要照護對象</h2>
        <form onSubmit={handleSetup} className="setup-form">
          {error && <p className="error-msg">{error}</p>}

          <div className="setup-identity-preview">
            <img src={identityPictureUrl || aiAvatar} alt={`${identityDisplayName} 頭像`} />
            <div>
              <strong>{identityDisplayName}</strong>
              <span>預設使用目前登入者的名稱與頭像，可再修改照護稱呼。</span>
            </div>
          </div>
          
          <label>
            主要照護對象稱呼 *
            <input
              type="text"
              value={careName}
              onChange={(e) => {
                careNameEditedRef.current = true;
                setCareName(e.target.value);
              }}
              placeholder="例：家中長輩、主要照護對象"
              required
            />
          </label>

          <label>
            家庭群組名稱（選填）
            <input
              type="text"
              value={familyName}
              onChange={(e) => setFamilyName(e.target.value)}
              placeholder="例：我的家庭群組"
            />
          </label>

          <div className="setup-info">
            <p>
              ✓ 建立後您可邀請家人加入<br/>
              ✓ 所有家人都能查看照護資訊與接收提醒<br/>
              ✓ 支援多人共同拍照新增照護資料
            </p>
          </div>

          <button type="submit" className="primary-action" disabled={loading}>
            {loading ? "建立中..." : "開始使用"}
          </button>
        </form>
      </div>
    </div>
  );
}
