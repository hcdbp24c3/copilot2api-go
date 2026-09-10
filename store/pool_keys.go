package store

import (
	"encoding/json"
	"os"

	"github.com/google/uuid"
)

// AddPoolKey adds a new pool key with a name and model prefix.
func AddPoolKey(name, prefix string) (*PoolKey, error) {
	accountMu.Lock()
	defer accountMu.Unlock()

	cfg, err := readPoolConfigFile()
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
	if err := writePoolConfigFile(cfg); err != nil {
		return nil, err
	}
	return &pk, nil
}

// DeletePoolKey removes a pool key by ID.
func DeletePoolKey(id string) error {
	accountMu.Lock()
	defer accountMu.Unlock()

	cfg, err := readPoolConfigFile()
	if err != nil {
		return err
	}
	for i, pk := range cfg.PoolKeys {
		if pk.ID == id {
			cfg.PoolKeys = append(cfg.PoolKeys[:i], cfg.PoolKeys[i+1:]...)
			return writePoolConfigFile(cfg)
		}
	}
	return nil
}

// UpdatePoolKey updates a pool key's name, prefix, and enabled state.
func UpdatePoolKey(id, name, prefix string, enabled bool) error {
	accountMu.Lock()
	defer accountMu.Unlock()

	cfg, err := readPoolConfigFile()
	if err != nil {
		return err
	}
	for i, pk := range cfg.PoolKeys {
		if pk.ID == id {
			cfg.PoolKeys[i].Name = name
			cfg.PoolKeys[i].Prefix = prefix
			cfg.PoolKeys[i].Enabled = enabled
			return writePoolConfigFile(cfg)
		}
	}
	return nil
}

// GetPoolKeyByKey finds an enabled pool key by its key string.
func GetPoolKeyByKey(key string) *PoolKey {
	accountMu.RLock()
	defer accountMu.RUnlock()

	cfg, err := readPoolConfigFile()
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

// readPoolConfigFile reads pool config without locking (caller must hold lock).
func readPoolConfigFile() (*PoolConfig, error) {
	data, err := os.ReadFile(PoolConfigFile())
	if err != nil {
		return &PoolConfig{Strategy: "round-robin"}, nil
	}
	var cfg PoolConfig
	if err := json.Unmarshal(data, &cfg); err != nil {
		return &PoolConfig{Strategy: "round-robin"}, nil
	}
	if cfg.Strategy == "" {
		cfg.Strategy = "round-robin"
	}
	return &cfg, nil
}

// writePoolConfigFile writes pool config without locking (caller must hold lock).
func writePoolConfigFile(cfg *PoolConfig) error {
	data, err := json.MarshalIndent(cfg, "", "  ")
	if err != nil {
		return err
	}
	return os.WriteFile(PoolConfigFile(), data, 0644)
}
