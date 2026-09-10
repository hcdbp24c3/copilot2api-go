# Pool Keys + Model Prefix + Endpoints Fix Implementation Plan

> **For agentic workers:** Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Support multiple pool keys with custom model prefixes, fix endpoint display, add "Add All Models" button

**Architecture:** Pool config stores an array of pool keys, each with a prefix. The `/v1/models` endpoint returns prefixed model names based on which pool key authenticated. Proxy auth middleware tracks the active pool key prefix.

**Tech Stack:** Go (Gin), React+Vite+TS, JSON file storage

---

## Task 1: Fix Endpoints `undefined` port

**Files:**
- Modify: `web/src/components/AccountCard.tsx:303-365`

The issue: `window.location.port` returns `""` for default ports (80/443), causing `http://host:undefined`.

**Steps:**

- [ ] Step 1: Fix `EndpointsPanel` to handle default port

In `web/src/components/AccountCard.tsx`, change the `EndpointsPanel` function:

```typescript
function EndpointsPanel({ apiKey }: { apiKey: string }) {
  const port = window.location.port ? `:${window.location.port}` : ""
  const proxyBase = `${window.location.protocol}//${window.location.hostname}${port}`
  // ... rest unchanged
```

- [ ] Step 2: Also fix in `PoolSettings` (`web/src/App.tsx:206`)

```typescript
const port = window.location.port ? `:${window.location.port}` : ""
const proxyBase = `${window.location.protocol}//${window.location.hostname}${port}`
```

- [ ] Step 3: Build frontend, verify

Run: `cd web && pnpm build`
Expected: builds without errors

- [ ] Step 4: Commit

```bash
git add web/src/components/AccountCard.tsx web/src/App.tsx
git commit -m "fix: handle default port in endpoint URLs"
```

---

## Task 2: Multi-pool-key storage + API

**Files:**
- Modify: `store/account.go` — PoolConfig struct, add PoolKey type
- Create: `store/pool_keys.go` — Pool key CRUD operations

**Current state:**
```go
type PoolConfig struct {
    Enabled      bool   `json:"enabled"`
    Strategy     string `json:"strategy"`
    ApiKey       string `json:"apiKey"`
    RateLimitRPM int    `json:"rateLimitRPM,omitempty"`
}
```

**New state:**
```go
type PoolKey struct {
    ID      string `json:"id"`
    Key     string `json:"key"`
    Prefix  string `json:"prefix"`   // e.g. "pool1" → models show as pool1/model
    Name    string `json:"name"`
    Enabled bool   `json:"enabled"`
}

type PoolConfig struct {
    Enabled      bool      `json:"enabled"`
    Strategy     string    `json:"strategy"`
    ApiKey       string    `json:"apiKey,omitempty"`  // legacy single key (kept for backward compat)
    PoolKeys     []PoolKey `json:"poolKeys,omitempty"`
    RateLimitRPM int       `json:"rateLimitRPM,omitempty"`
}
```

**Steps:**

- [ ] Step 1: Add PoolKey struct to `store/account.go`

```go
type PoolKey struct {
    ID      string `json:"id"`
    Key     string `json:"key"`
    Prefix  string `json:"prefix"`
    Name    string `json:"name"`
    Enabled bool   `json:"enabled"`
}
```

Update PoolConfig:
```go
type PoolConfig struct {
    Enabled      bool      `json:"enabled"`
    Strategy     string    `json:"strategy"`
    ApiKey       string    `json:"apiKey,omitempty"`
    PoolKeys     []PoolKey `json:"poolKeys,omitempty"`
    RateLimitRPM int       `json:"rateLimitRPM,omitempty"`
}
```

- [ ] Step 2: Create `store/pool_keys.go` with CRUD functions

```go
package store

import "github.com/google/uuid"

func AddPoolKey(name, prefix string) (*PoolKey, error) {
    cfg, err := GetPoolConfig()
    if err != nil {
        return nil, err
    }
    pk := PoolKey{
        ID:      uuid.New().String(),
        Key:     "sk-pool-" + uuid.New().String(),
        Prefix:  prefix,
        Name:    name,
        Enabled: true,
    }
    cfg.PoolKeys = append(cfg.PoolKeys, pk)
    if err := UpdatePoolConfig(cfg); err != nil {
        return nil, err
    }
    return &pk, nil
}

func DeletePoolKey(id string) error {
    cfg, err := GetPoolConfig()
    if err != nil {
        return err
    }
    for i, pk := range cfg.PoolKeys {
        if pk.ID == id {
            cfg.PoolKeys = append(cfg.PoolKeys[:i], cfg.PoolKeys[i+1:]...)
            return UpdatePoolConfig(cfg)
        }
    }
    return nil
}

func UpdatePoolKey(id string, name, prefix string, enabled bool) error {
    cfg, err := GetPoolConfig()
    if err != nil {
        return err
    }
    for i, pk := range cfg.PoolKeys {
        if pk.ID == id {
            cfg.PoolKeys[i].Name = name
            cfg.PoolKeys[i].Prefix = prefix
            cfg.PoolKeys[i].Enabled = enabled
            return UpdatePoolConfig(cfg)
        }
    }
    return nil
}

func GetPoolKeyByKey(key string) *PoolKey {
    cfg, err := GetPoolConfig()
    if err != nil {
        return nil
    }
    for _, pk := range cfg.PoolKeys {
        if pk.Enabled && pk.Key == key {
            return &pk
        }
    }
    return nil
}

// FindPoolKeyByPrefix returns the pool key matching a prefix.
func FindPoolKeyByPrefix(prefix string) *PoolKey {
    cfg, err := GetPoolConfig()
    if err != nil {
        return nil
    }
    for _, pk := range cfg.PoolKeys {
        if pk.Enabled && pk.Prefix == prefix {
            return &pk
        }
    }
    return nil
}
```

- [ ] Step 3: Build Go, verify

Run: `/usr/local/go/bin/go build ./...`
Expected: no errors

- [ ] Step 4: Commit

```bash
git add store/account.go store/pool_keys.go
git commit -m "feat: add PoolKey type and CRUD operations"
```

---

## Task 3: Update proxy auth to identify pool key + prefix

**Files:**
- Modify: `handler/proxy.go:48-86` — proxyAuth middleware
- Modify: `handler/proxy.go:91-123` — resolveState function

**Steps:**

- [ ] Step 1: Update proxyAuth to check pool keys

```go
func proxyAuth() gin.HandlerFunc {
    return func(c *gin.Context) {
        authHeader := c.GetHeader("Authorization")
        if authHeader == "" {
            apiKey := c.GetHeader("x-api-key")
            if apiKey != "" {
                authHeader = "Bearer " + apiKey
            }
        }
        if authHeader == "" {
            c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{"error": "missing authorization"})
            return
        }
        token := strings.TrimPrefix(authHeader, "Bearer ")

        // Check pool API keys (new multi-key system)
        poolCfg, _ := store.GetPoolConfig()
        if poolCfg != nil && poolCfg.Enabled {
            // Check legacy single key
            if poolCfg.ApiKey == token {
                c.Set("isPool", true)
                c.Set("poolStrategy", poolCfg.Strategy)
                c.Set("poolPrefix", "")
                c.Next()
                return
            }
            // Check multi-pool keys
            if pk := store.GetPoolKeyByKey(token); pk != nil {
                c.Set("isPool", true)
                c.Set("poolStrategy", poolCfg.Strategy)
                c.Set("poolPrefix", pk.Prefix)
                c.Set("poolKeyName", pk.Name)
                c.Next()
                return
            }
        }

        // Check individual account API key
        account, err := store.GetAccountByApiKey(token)
        if err != nil || account == nil {
            c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{"error": "invalid API key"})
            return
        }
        c.Set("accountID", account.ID)
        c.Set("isPool", false)
        c.Next()
    }
}
```

- [ ] Step 2: Build Go, verify

Run: `/usr/local/go/bin/go build ./...`
Expected: no errors

- [ ] Step 3: Commit

```bash
git add handler/proxy.go
git commit -m "feat: proxy auth identifies pool key prefix"
```

---

## Task 4: Update /v1/models to return prefixed models per pool key

**Files:**
- Modify: `instance/handler.go:70-107` — ModelsHandler
- Modify: `handler/proxy.go:217-223` — proxyModels

**Steps:**

- [ ] Step 1: Add ModelsHandlerPool that accepts a prefix parameter

In `instance/handler.go`, add:

```go
func ModelsHandlerPool(c *gin.Context, state *config.State, prefix string) {
    state.RLock()
    models := state.SDKModels
    if models == nil {
        models = state.Models
    }
    state.RUnlock()

    if models == nil {
        c.JSON(http.StatusOK, config.ModelsResponse{Object: "list", Data: []config.ModelEntry{}})
        return
    }

    mapped := config.ModelsResponse{
        Object: models.Object,
        Data:   make([]config.ModelEntry, len(models.Data)),
    }
    for i, m := range models.Data {
        displayID := store.ToDisplayID(m.ID)
        if prefix != "" {
            displayID = prefix + "/" + displayID
        }
        mapped.Data[i] = config.ModelEntry{
            ID:           displayID,
            Object:       m.Object,
            Created:      m.Created,
            OwnedBy:      m.OwnedBy,
            Name:         m.Name,
            Version:      m.Version,
            Vendor:       m.Vendor,
            Capabilities: m.Capabilities,
        }
    }
    c.JSON(http.StatusOK, mapped)
}
```

- [ ] Step 2: Update proxyModels to pass prefix from context

```go
func proxyModels(c *gin.Context) {
    resolved := resolveState(c, nil)
    if resolved == nil {
        return
    }
    prefix, _ := c.Get("poolPrefix")
    prefixStr, _ := prefix.(string)
    instance.ModelsHandlerPool(c, resolved.State, prefixStr)
}
```

- [ ] Step 3: Build Go, verify

Run: `/usr/local/go/bin/go build ./...`
Expected: no errors

- [ ] Step 4: Commit

```bash
git add instance/handler.go handler/proxy.go
git commit -m "feat: /v1/models returns prefixed model names per pool key"
```

---

## Task 5: Add pool key API endpoints

**Files:**
- Modify: `handler/console_api.go` — register new routes
- Modify: `handler/console_api.go` — add handler functions

**Steps:**

- [ ] Step 1: Add routes in RegisterConsoleAPI

```go
// Pool key management
protected.GET("/pool/keys", handleGetPoolKeys)
protected.POST("/pool/keys", handleAddPoolKey)
protected.PUT("/pool/keys/:id", handleUpdatePoolKey)
protected.DELETE("/pool/keys/:id", handleDeletePoolKey)
```

- [ ] Step 2: Add handler functions

```go
func handleGetPoolKeys(c *gin.Context) {
    cfg, err := store.GetPoolConfig()
    if err != nil {
        c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
        return
    }
    c.JSON(http.StatusOK, cfg.PoolKeys)
}

func handleAddPoolKey(c *gin.Context) {
    var body struct {
        Name   string `json:"name"`
        Prefix string `json:"prefix"`
    }
    if err := c.ShouldBindJSON(&body); err != nil || body.Name == "" || body.Prefix == "" {
        c.JSON(http.StatusBadRequest, gin.H{"error": "name and prefix are required"})
        return
    }
    pk, err := store.AddPoolKey(body.Name, body.Prefix)
    if err != nil {
        c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
        return
    }
    c.JSON(http.StatusCreated, pk)
}

func handleUpdatePoolKey(c *gin.Context) {
    id := c.Param("id")
    var body struct {
        Name    string `json:"name"`
        Prefix  string `json:"prefix"`
        Enabled bool   `json:"enabled"`
    }
    if err := c.ShouldBindJSON(&body); err != nil {
        c.JSON(http.StatusBadRequest, gin.H{"error": "invalid request"})
        return
    }
    if err := store.UpdatePoolKey(id, body.Name, body.Prefix, body.Enabled); err != nil {
        c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
        return
    }
    c.JSON(http.StatusOK, gin.H{"success": true})
}

func handleDeletePoolKey(c *gin.Context) {
    id := c.Param("id")
    if err := store.DeletePoolKey(id); err != nil {
        c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
        return
    }
    c.JSON(http.StatusOK, gin.H{"success": true})
}
```

- [ ] Step 3: Build Go, verify

Run: `/usr/local/go/bin/go build ./...`
Expected: no errors

- [ ] Step 4: Commit

```bash
git add handler/console_api.go
git commit -m "feat: add pool key CRUD API endpoints"
```

---

## Task 6: Frontend — Pool Key management UI

**Files:**
- Modify: `web/src/api.ts` — add pool key API functions
- Modify: `web/src/App.tsx` — add PoolKeysPanel component
- Modify: `web/src/i18n.tsx` — add translations

**Steps:**

- [ ] Step 1: Add pool key API functions in `web/src/api.ts`

```typescript
export interface PoolKey {
  id: string
  key: string
  prefix: string
  name: string
  enabled: boolean
}

// Add to api object:
getPoolKeys: () => request<Array<PoolKey>>("/pool/keys"),
addPoolKey: (data: { name: string; prefix: string }) =>
  request<PoolKey>("/pool/keys", { method: "POST", body: JSON.stringify(data) }),
updatePoolKey: (id: string, data: { name: string; prefix: string; enabled: boolean }) =>
  request<void>(`/pool/keys/${id}`, { method: "PUT", body: JSON.stringify(data) }),
deletePoolKey: (id: string) =>
  request<void>(`/pool/keys/${id}`, { method: "DELETE" }),
```

- [ ] Step 2: Add PoolKeysPanel component in App.tsx

Create a panel that shows:
- Table of pool keys (name, prefix, key masked, enabled toggle)
- "Add Pool Key" form (name + prefix)
- Copy/delete/regenerate buttons

```tsx
function PoolKeysPanel() {
  const [keys, setKeys] = useState<Array<PoolKey>>([])
  const [loading, setLoading] = useState(false)
  const [fetched, setFetched] = useState(false)
  const [open, setOpen] = useState(false)
  const [newName, setNewName] = useState("")
  const [newPrefix, setNewPrefix] = useState("")
  const t = useT()

  const fetchKeys = async () => {
    setLoading(true)
    try { const data = await api.getPoolKeys(); setKeys(data); setFetched(true); setOpen(true) }
    catch (err) { console.error("Failed to fetch pool keys:", err) }
    finally { setLoading(false) }
  }

  const addKey = async () => {
    if (!newName || !newPrefix) return
    try {
      await api.addPoolKey({ name: newName, prefix: newPrefix })
      setNewName(""); setNewPrefix("")
      const data = await api.getPoolKeys(); setKeys(data)
    } catch (err) { console.error("Add pool key failed:", err) }
  }

  const deleteKey = async (id: string) => {
    try {
      await api.deletePoolKey(id)
      const data = await api.getPoolKeys(); setKeys(data)
    } catch (err) { console.error("Delete pool key failed:", err) }
  }

  // ... render table + form
}
```

- [ ] Step 3: Add PoolKeysPanel to Dashboard, after PoolSettings

```tsx
<PoolSettings pool={pool} onChange={setPool} />
<PoolKeysPanel />
```

- [ ] Step 4: Add translations in i18n.tsx

```typescript
poolKeys: "Pool Keys",
poolKeysDesc: "Multiple API keys with custom model prefixes",
addPoolKey: "Add Pool Key",
poolKeyName: "Name",
poolKeyPrefix: "Prefix",
poolKeyValue: "Key",
poolKeyEnabled: "Enabled",
deletePoolKey: "Delete",
```

- [ ] Step 5: Build frontend, verify

Run: `cd web && pnpm build`
Expected: builds without errors

- [ ] Step 6: Commit

```bash
git add web/src/api.ts web/src/App.tsx web/src/i18n.tsx
git commit -m "feat: pool key management UI"
```

---

## Task 7: "Add All Models" button for Copilot Models

**Files:**
- Modify: `web/src/App.tsx` — ModelMappingPanel component

**Steps:**

- [ ] Step 1: Add "Add All" button in ModelMappingPanel

In the Copilot Models section, after the "Fetch Models" button, add:

```tsx
{modelsFetched && unmappedCount > 0 && (
  <button onClick={addAllUnmapped} disabled={saving} style={{ fontSize: 12, padding: "4px 12px" }}>
    {t("addAllModels")} ({unmappedCount})
  </button>
)}
```

- [ ] Step 2: Add addAllUnmapped function

```typescript
const unmappedCount = copilotModels.filter(m => !m.mapped && !mappings.some(mm => mm.copilotId === m.id)).length

const addAllUnmapped = () => {
  const newMappings = [...mappings]
  for (const m of copilotModels) {
    if (!m.mapped && !newMappings.some(mm => mm.copilotId === m.id)) {
      newMappings.push({ copilotId: m.id, displayId: "", displayName: "" })
    }
  }
  setMappings(newMappings)
}
```

- [ ] Step 3: Add translation

```typescript
addAllModels: "Add All Models",
```

- [ ] Step 4: Build frontend, verify

Run: `cd web && pnpm build`
Expected: builds without errors

- [ ] Step 5: Commit

```bash
git add web/src/App.tsx web/src/i18n.tsx
git commit -m "feat: Add All Models button in Copilot Models panel"
```

---

## Task 8: Build + Tag + Push

**Steps:**

- [ ] Step 1: Full build

```bash
/usr/local/go/bin/go build ./...
cd web && pnpm build
```

- [ ] Step 2: Commit all, tag v0.5.0

```bash
cd /root/repos/copilot2api-go
git add -A
git commit -m "feat: multi-pool-keys, model prefix, add-all-models, endpoint fix"
git tag v0.5.0
git push fork master && git push fork v0.5.0
```

- [ ] Step 3: Verify CI build

```bash
gh run list --repo hcdbp24c3/copilot2api-go --limit 3
```

---

## Summary

| Feature | Files Changed |
|---------|--------------|
| Fix endpoint port | `web/src/components/AccountCard.tsx`, `web/src/App.tsx` |
| PoolKey struct | `store/account.go`, `store/pool_keys.go` |
| Pool key auth | `handler/proxy.go` |
| Prefixed models | `instance/handler.go`, `handler/proxy.go` |
| Pool key API | `handler/console_api.go` |
| Pool key UI | `web/src/api.ts`, `web/src/App.tsx`, `web/src/i18n.tsx` |
| Add All Models | `web/src/App.tsx`, `web/src/i18n.tsx` |
