import { useCallback, useEffect, useRef, useState } from "react"

import { api } from "../api"
import { useT } from "../i18n"

interface Props {
  onComplete: () => Promise<void>
  onCancel: () => void
}

type Step = "config" | "authorize" | "done"
type AuthMode = "oauth" | "token"

function DeviceCodeDisplay({
  userCode,
  verificationUri,
}: {
  userCode: string
  verificationUri: string
}) {
  const t = useT()
  return (
    <div style={{ textAlign: "center", padding: "20px 0" }}>
      <p
        style={{
          color: "var(--text-muted)",
          fontSize: 14,
          marginBottom: 16,
        }}
      >
        {t("enterCode")}
      </p>
      <div
        onClick={() => void navigator.clipboard.writeText(userCode)}
        style={{
          display: "inline-block",
          padding: "12px 24px",
          background: "var(--bg)",
          border: "2px solid var(--accent)",
          borderRadius: "var(--radius)",
          fontSize: 28,
          fontWeight: 700,
          fontFamily: "monospace",
          letterSpacing: 4,
          cursor: "pointer",
          userSelect: "all",
          marginBottom: 8,
        }}
        title="Click to copy"
      >
        {userCode}
      </div>
      <p style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 16 }}>
        {t("clickToCopy")}
      </p>
      <a
        href={verificationUri}
        target="_blank"
        rel="noopener noreferrer"
        style={{
          display: "inline-block",
          padding: "8px 20px",
          background: "var(--accent)",
          color: "#fff",
          borderRadius: "var(--radius)",
          textDecoration: "none",
          fontSize: 14,
        }}
      >
        {t("openGithub")}
      </a>
    </div>
  )
}

function AuthorizeStep({
  userCode,
  verificationUri,
  authStatus,
  error,
  onCancel,
}: {
  userCode: string
  verificationUri: string
  authStatus: string
  error: string
  onCancel: () => void
}) {
  const t = useT()
  return (
    <div>
      <h3 style={{ fontSize: 15, fontWeight: 600, marginBottom: 16 }}>
        {t("githubAuth")}
      </h3>
      <DeviceCodeDisplay
        userCode={userCode}
        verificationUri={verificationUri}
      />
      <p
        style={{
          fontSize: 13,
          color: "var(--text-muted)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          gap: 8,
          marginTop: 16,
        }}
      >
        <span
          style={{
            display: "inline-block",
            width: 8,
            height: 8,
            borderRadius: "50%",
            background: "var(--yellow)",
            animation: "pulse 1.5s infinite",
          }}
        />
        {authStatus}
      </p>
      {error && (
        <div
          style={{
            color: "var(--red)",
            fontSize: 13,
            textAlign: "center",
            marginBottom: 12,
          }}
        >
          {error}
        </div>
      )}
      <div style={{ display: "flex", justifyContent: "center", marginTop: 8 }}>
        <button type="button" onClick={onCancel}>
          {t("cancel")}
        </button>
      </div>
    </div>
  )
}

export function AddAccountForm({ onComplete, onCancel }: Props) {
  const [step, setStep] = useState<Step>("config")
  const [authMode, setAuthMode] = useState<AuthMode>("oauth")
  const [name, setName] = useState("")
  const [accountType, setAccountType] = useState("individual")
  const [token, setToken] = useState("")
  const [error, setError] = useState("")
  const [loading, setLoading] = useState(false)

  // OAuth device flow state
  const [userCode, setUserCode] = useState("")
  const [verificationUri, setVerificationUri] = useState("")
  const [authStatus, setAuthStatus] = useState("")
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const t = useT()

  const cleanup = useCallback(() => {
    if (pollRef.current) {
      clearInterval(pollRef.current)
      pollRef.current = null
    }
  }, [])

  useEffect(() => cleanup, [cleanup])

  // OAuth device flow
  const startOAuth = async () => {
    setError("")
    setLoading(true)
    try {
      const result = await api.startDeviceCode()
      setUserCode(result.userCode)
      setVerificationUri(result.verificationUri)
      setStep("authorize")
      setAuthStatus(t("waitingAuth"))

      pollRef.current = setInterval(() => {
        void (async () => {
          try {
            const poll = await api.pollAuth(result.sessionId)
            if (poll.status === "completed") {
              cleanup()
              setAuthStatus(t("authorized"))
              await api.completeAuth({
                sessionId: result.sessionId,
                name: name.trim() || "GitHub Account",
                accountType,
              })
              setStep("done")
              await onComplete()
            } else if (poll.status === "expired" || poll.status === "error") {
              cleanup()
              setAuthStatus("")
              setError(poll.error ?? t("authFailed"))
            }
          } catch {
            // poll error, keep trying
          }
        })()
      }, 3000)
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setLoading(false)
    }
  }

  // Token auth
  const submitToken = async () => {
    if (!token.trim()) {
      setError(t("tokenRequired"))
      return
    }
    setError("")
    setLoading(true)
    try {
      await api.addToken({
        name: name.trim() || "GitHub Account",
        githubToken: token.trim(),
        accountType,
      })
      setStep("done")
      await onComplete()
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setLoading(false)
    }
  }

  const handleConfigSubmit = (e: React.SyntheticEvent) => {
    e.preventDefault()
    if (authMode === "token") {
      void submitToken()
    } else {
      if (!name.trim()) {
        setError(t("accountNameRequired"))
        return
      }
      void startOAuth()
    }
  }

  if (step === "done") return null

  return (
    <div
      style={{
        background: "var(--bg-card)",
        border: "1px solid var(--border)",
        borderRadius: "var(--radius)",
        padding: 20,
        marginBottom: 16,
      }}
    >
      {step === "config" && (
        <form onSubmit={handleConfigSubmit}>
          <h3 style={{ fontSize: 15, fontWeight: 600, marginBottom: 16 }}>
            {t("addAccountTitle")}
          </h3>
          <div style={{ display: "grid", gap: 12, marginBottom: 12 }}>
            {authMode === "oauth" && (
              <div>
                <label htmlFor="acc-name">{t("accountName")}</label>
                <input
                  id="acc-name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder={t("accountNamePlaceholder")}
                />
              </div>
            )}
            <div>
              <label htmlFor="acc-type">{t("accountType")}</label>
              <select
                id="acc-type"
                value={accountType}
                onChange={(e) => setAccountType(e.target.value)}
              >
                <option value="individual">{t("individual")}</option>
                <option value="business">{t("business")}</option>
                <option value="enterprise">{t("enterprise")}</option>
              </select>
            </div>
          </div>

          {/* Auth mode tabs */}
          <div
            style={{
              display: "flex",
              gap: 0,
              marginBottom: 16,
              borderRadius: "var(--radius)",
              border: "1px solid var(--border)",
              overflow: "hidden",
            }}
          >
            <button
              type="button"
              onClick={() => {
                setAuthMode("oauth")
                setError("")
              }}
              style={{
                flex: 1,
                padding: "10px 16px",
                border: "none",
                cursor: "pointer",
                fontSize: 13,
                fontWeight: 500,
                background: authMode === "oauth" ? "var(--accent)" : "var(--bg)",
                color: authMode === "oauth" ? "#fff" : "var(--text)",
                transition: "all 0.15s",
              }}
            >
              {t("loginWithGithub")}
            </button>
            <button
              type="button"
              onClick={() => {
                setAuthMode("token")
                setError("")
              }}
              style={{
                flex: 1,
                padding: "10px 16px",
                border: "none",
                cursor: "pointer",
                fontSize: 13,
                fontWeight: 500,
                background: authMode === "token" ? "var(--accent)" : "var(--bg)",
                color: authMode === "token" ? "#fff" : "var(--text)",
                transition: "all 0.15s",
              }}
            >
              {t("addWithToken")}
            </button>
          </div>

          {/* Token input (only in token mode) */}
          {authMode === "token" && (
            <div style={{ display: "grid", gap: 12, marginBottom: 12 }}>
              <div>
                <label htmlFor="token">{t("tokenLabel")}</label>
                <input
                  id="token"
                  type="password"
                  value={token}
                  onChange={(e) => setToken(e.target.value)}
                  placeholder={t("tokenPlaceholder")}
                  autoComplete="off"
                />
              </div>
            </div>
          )}

          {error && (
            <div style={{ color: "var(--red)", fontSize: 13, marginBottom: 12 }}>
              {error}
            </div>
          )}
          <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
            <button type="button" onClick={onCancel}>
              {t("cancel")}
            </button>
            <button type="submit" className="primary" disabled={loading}>
              {loading
                ? authMode === "token"
                  ? t("tokenValidating")
                  : t("starting")
                : authMode === "token"
                  ? t("addWithToken")
                  : t("loginWithGithub")}
            </button>
          </div>
        </form>
      )}
      {step === "authorize" && (
        <AuthorizeStep
          userCode={userCode}
          verificationUri={verificationUri}
          authStatus={authStatus}
          error={error}
          onCancel={() => {
            cleanup()
            onCancel()
          }}
        />
      )}
      <style>{`
        @keyframes pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.3; }
        }
      `}</style>
    </div>
  )
}
