import { useEffect, useState } from "react";

export default function LoginSetup({ identity, onSetupComplete }) {
  const [step, setStep] = useState("check"); // check, setup, success
  const [familyName, setFamilyName] = useState("");
  const [careName, setCareName] = useState("家中長輩");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    let isMounted = true;
    async function checkFamily() {
      try {
        const res = await fetch("/api/me", {
          headers: { Authorization: `Bearer ${identity.idToken}` },
        });
        const data = await res.json();
        
        if (!isMounted) return;
        if (data.is_first_time) {
          setStep("setup");
        } else {
          setStep("done");
          if (onSetupComplete) onSetupComplete(data);
        }
      } catch (err) {
        if (!isMounted) return;
        setError(err.message || "檢查失敗");
        setStep("setup");
      }
    }

    if (identity?.idToken && step === "check") {
      checkFamily();
    }
    return () => {
      isMounted = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [identity]);

  async function handleSetup(e) {
    e.preventDefault();
    setLoading(true);
    setError(null);

    try {
      const res = await fetch("/api/me", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${identity.idToken}`,
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
              if (onSetupComplete) onSetupComplete();
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
          
          <label>
            主要照護對象稱呼 *
            <input
              type="text"
              value={careName}
              onChange={(e) => setCareName(e.target.value)}
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
              ✓ 支持多人共同上傳看診單據
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
