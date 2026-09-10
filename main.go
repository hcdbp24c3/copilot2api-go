package main

import (
	"flag"
	"fmt"
	"log"
	"net/http"

	"copilot-go/config"
	"copilot-go/handler"
	"copilot-go/instance"
	"copilot-go/store"

	"github.com/gin-gonic/gin"
)

func main() {
	port := flag.Int("port", 4141, "Server port (dashboard + proxy)")
	proxyPort := flag.Int("proxy-port", 4141, "Proxy port for endpoint display (same as --port)")
	verbose := flag.Bool("verbose", false, "Enable verbose logging")
	autoStart := flag.Bool("auto-start", true, "Auto-start enabled accounts")
	flag.Parse()

	if !*verbose {
		gin.SetMode(gin.ReleaseMode)
	}

	// Ensure data directories exist
	if err := store.EnsurePaths(); err != nil {
		log.Fatalf("Failed to initialize data paths: %v", err)
	}

	// Load proxy config and apply to HTTP clients
	if proxyCfg, err := store.GetProxyConfig(); err == nil && proxyCfg.ProxyURL != "" {
		config.SetProxyURL(proxyCfg.ProxyURL)
		instance.RebuildHTTPClients()
		log.Printf("Using HTTP proxy: %s", proxyCfg.ProxyURL)
	}

	// Auto-start enabled accounts
	if *autoStart {
		accounts, err := store.GetEnabledAccounts()
		if err != nil {
			log.Printf("Warning: failed to load accounts: %v", err)
		}

		// Handle environment token: create or update account from env var.
		// Supports COPILOT_GITHUB_TOKEN, GH_TOKEN, GITHUB_TOKEN (priority order).
		if envToken, ok := config.ResolveGitHubToken(); ok {
			envAccount, err := store.GetOrCreateEnvTokenAccount(envToken)
			if err != nil {
				log.Printf("Failed to sync env token account: %v", err)
			} else {
				// Ensure the env account is in the list and not duplicated
				found := false
				for i, a := range accounts {
					if a.ID == envAccount.ID {
						accounts[i] = *envAccount
						found = true
						break
					}
				}
				if !found {
					accounts = append(accounts, *envAccount)
				}
			}
		}

		for _, account := range accounts {
			go func(a store.Account) {
				if err := instance.StartInstance(a); err != nil {
					log.Printf("Failed to auto-start account %s: %v", a.Name, err)
				}
			}(account)
		}
	}

	// Single engine: dashboard + proxy on one port
	engine := gin.New()
	engine.RedirectTrailingSlash = false
	engine.RedirectFixedPath = false
	engine.RemoveExtraSlash = false

	if *verbose {
		engine.Use(gin.Logger())
	}
	engine.Use(gin.Recovery())

	// Health check
	engine.GET("/health", func(c *gin.Context) {
		c.JSON(http.StatusOK, gin.H{"status": "ok"})
	})

	// Register dashboard API + frontend
	handler.RegisterConsoleAPI(engine, *proxyPort)

	// Register proxy routes (with proxyAuth middleware)
	handler.RegisterProxy(engine)

	log.Printf("Server listening on :%d (dashboard + proxy)", *port)
	if err := engine.Run(fmt.Sprintf(":%d", *port)); err != nil {
		log.Fatalf("Server failed: %v", err)
	}
}
