package main

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func TestConfirmLocalExecutionApprovesYes(t *testing.T) {
	var output bytes.Buffer
	approved := confirmLocalExecution(strings.NewReader("yes\n"), &output, MessageEnvelope{
		AppID:   "app_001",
		Channel: "hermes.task.create",
	}, "hermes")
	if !approved {
		t.Fatal("expected yes to approve local execution")
	}
	if !strings.Contains(output.String(), "app_001") || !strings.Contains(output.String(), "hermes.task.create") {
		t.Fatalf("confirmation prompt missing routing context: %q", output.String())
	}
}

func TestConfirmLocalExecutionDeniesEmptyInput(t *testing.T) {
	var output bytes.Buffer
	approved := confirmLocalExecution(strings.NewReader(""), &output, MessageEnvelope{
		AppID:   "app_001",
		Channel: "hermes.task.create",
	}, "hermes")
	if approved {
		t.Fatal("expected empty non-interactive input to deny local execution")
	}
}

func TestConfirmLocalExecutionDeniesNonYes(t *testing.T) {
	var output bytes.Buffer
	approved := confirmLocalExecution(strings.NewReader("no\n"), &output, MessageEnvelope{
		AppID:   "app_001",
		Channel: "hermes.task.create",
	}, "hermes")
	if approved {
		t.Fatal("expected non-yes input to deny local execution")
	}
}

func TestReplayCacheRejectsDuplicateWithinTTL(t *testing.T) {
	cache := newReplayCache(time.Minute)
	now := time.Unix(100, 0)
	if cache.Seen("message:msg_001", now) {
		t.Fatal("first message id should not be considered replay")
	}
	if !cache.Seen("message:msg_001", now.Add(time.Second)) {
		t.Fatal("duplicate message id should be considered replay")
	}
}

func TestReplayCacheExpiresOldEntries(t *testing.T) {
	cache := newReplayCache(time.Minute)
	now := time.Unix(100, 0)
	if cache.Seen("nonce:abc", now) {
		t.Fatal("first nonce should not be considered replay")
	}
	if cache.Seen("nonce:abc", now.Add(2*time.Minute)) {
		t.Fatal("expired nonce should not be considered replay")
	}
}

func TestResultChannelForHermes(t *testing.T) {
	if got := resultChannelFor("hermes.task.create"); got != "hermes.task.event" {
		t.Fatalf("expected Hermes event channel, got %q", got)
	}
}

func TestResultChannelForEcho(t *testing.T) {
	if got := resultChannelFor("echo.echo"); got != "echo.event" {
		t.Fatalf("expected echo event channel, got %q", got)
	}
}

func TestDeveloperHermesSetupCreatesLocalConfig(t *testing.T) {
	var requests []string
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		requests = append(requests, r.Method+" "+r.URL.Path)
		w.Header().Set("Content-Type", "application/json")
		switch {
		case r.Method == "POST" && r.URL.Path == "/v1/developers":
			var body map[string]interface{}
			_ = json.NewDecoder(r.Body).Decode(&body)
			if body["name"] != "Hermes Dev" || body["email"] != "dev@example.test" {
				t.Fatalf("unexpected developer body: %#v", body)
			}
			_, _ = w.Write([]byte(`{"developer":{"id":"devacct_123"}}`))
		case r.Method == "POST" && r.URL.Path == "/v1/publishers":
			var body map[string]interface{}
			_ = json.NewDecoder(r.Body).Decode(&body)
			if body["developer_id"] != "devacct_123" || body["display_name"] != "Hermes Publisher" {
				t.Fatalf("unexpected publisher body: %#v", body)
			}
			_, _ = w.Write([]byte(`{"publisher":{"id":"pub_123"}}`))
		case r.Method == "POST" && r.URL.Path == "/v1/developer/apps":
			var body map[string]interface{}
			_ = json.NewDecoder(r.Body).Decode(&body)
			if body["workspace_id"] != "ws_local" || body["name"] != "Hermes Companion" || body["publisher_id"] != "pub_123" {
				t.Fatalf("unexpected app body: %#v", body)
			}
			if body["public_key"] == "" {
				t.Fatal("app public key was not sent")
			}
			_, _ = w.Write([]byte(`{"app_id":"app_123","app_key_id":"appkey_123","api_key":"musubi_app_sk_test","api_key_record":{"id":"apikey_123"}}`))
		case r.Method == "POST" && r.URL.Path == "/v1/developer/apps/app_123/permission-declarations":
			var body struct {
				PluginName string   `json:"plugin_name"`
				Channels   []string `json:"channels"`
			}
			_ = json.NewDecoder(r.Body).Decode(&body)
			if body.PluginName != "hermes" || strings.Join(body.Channels, ",") != "hermes.task.create,hermes.task.cancel,hermes.task.status" {
				t.Fatalf("unexpected declaration body: %#v", body)
			}
			_, _ = w.Write([]byte(`{"declaration":{"id":"apd_123"}}`))
		case r.Method == "POST" && r.URL.Path == "/v1/consent-requests":
			var body struct {
				AppID string `json:"app_id"`
			}
			_ = json.NewDecoder(r.Body).Decode(&body)
			if body.AppID != "app_123" {
				t.Fatalf("unexpected consent body: %#v", body)
			}
			_, _ = w.Write([]byte(`{"consent_request_id":"consent_123","consent_url":"/control-plane#consent/consent_123"}`))
		default:
			http.Error(w, "not found", http.StatusNotFound)
		}
	}))
	defer server.Close()

	home := t.TempDir()
	err := runDeveloperHermesSetupCLI([]string{
		"--server", server.URL,
		"--home", home,
		"--workspace", "ws_local",
		"--developer-name", "Hermes Dev",
		"--developer-email", "dev@example.test",
		"--publisher-name", "Hermes Publisher",
		"--app-name", "Hermes Companion",
	})
	if err != nil {
		t.Fatal(err)
	}

	configBytes, err := os.ReadFile(filepath.Join(home, "apps", "app_123.json"))
	if err != nil {
		t.Fatal(err)
	}
	var config map[string]string
	if err := json.Unmarshal(configBytes, &config); err != nil {
		t.Fatal(err)
	}
	for _, key := range []string{"workspace_id", "app_id", "app_key_id", "app_api_key", "app_private_key", "app_public_key", "developer_id", "publisher_id", "permission_id", "consent_request_id", "consent_url"} {
		if config[key] == "" {
			t.Fatalf("config missing %s: %#v", key, config)
		}
	}
	if config["declared_channels"] != "hermes.task.create,hermes.task.cancel,hermes.task.status" {
		t.Fatalf("unexpected declared channels: %q", config["declared_channels"])
	}
	if config["consent_url"] != server.URL+"/control-plane#consent/consent_123" {
		t.Fatalf("unexpected consent url: %q", config["consent_url"])
	}
	if got := strings.Join(requests, "\n"); !strings.Contains(got, "POST /v1/developers") || !strings.Contains(got, "POST /v1/consent-requests") {
		t.Fatalf("setup did not call expected endpoints:\n%s", got)
	}
}

func TestDeveloperHermesSetupUsage(t *testing.T) {
	err := runDeveloperCLI([]string{"hermes"})
	if err == nil || !strings.Contains(err.Error(), "musubi developer hermes setup") {
		t.Fatalf("expected developer hermes setup usage, got %v", err)
	}
}

func TestDeviceRegisterWithHermesCreatesUserOwnedAppGrantConfigAndPolicy(t *testing.T) {
	var requests []string
	var devicePublicKey string
	var appPublicKey string
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		requests = append(requests, r.Method+" "+r.URL.Path)
		w.Header().Set("Content-Type", "application/json")
		switch {
		case r.Method == "POST" && r.URL.Path == "/v1/devices/register":
			var body map[string]interface{}
			_ = json.NewDecoder(r.Body).Decode(&body)
			if body["workspace_id"] != "ws_local" || body["device_name"] != "Hermes Mac" {
				t.Fatalf("unexpected device register body: %#v", body)
			}
			devicePublicKey, _ = body["public_key"].(string)
			_, _ = w.Write([]byte(`{"device_id":"dev_123","device_key_id":"devkey_123","relay_url":"ws://127.0.0.1:8787/v1/devices/dev_123/connect"}`))
		case r.Method == "POST" && r.URL.Path == "/v1/apps":
			var body map[string]interface{}
			_ = json.NewDecoder(r.Body).Decode(&body)
			if body["workspace_id"] != "ws_local" || body["name"] != "Hermes Companion" || body["type"] != "user_owned" {
				t.Fatalf("unexpected app body: %#v", body)
			}
			appPublicKey, _ = body["public_key"].(string)
			_, _ = w.Write([]byte(`{"app_id":"app_hermes","app_key_id":"appkey_hermes","status":"active"}`))
		case r.Method == "POST" && r.URL.Path == "/v1/apps/app_hermes/api-keys":
			_, _ = w.Write([]byte(`{"api_key":"musubi_app_sk_local","key":{"id":"apikey_hermes","prefix":"musubi_app","status":"active"}}`))
		case r.Method == "POST" && r.URL.Path == "/v1/grants":
			var body struct {
				WorkspaceID     string   `json:"workspace_id"`
				AppID           string   `json:"app_id"`
				DeviceID        string   `json:"device_id"`
				AllowedChannels []string `json:"allowed_channels"`
				QueueingAllowed bool     `json:"queueing_allowed"`
			}
			_ = json.NewDecoder(r.Body).Decode(&body)
			if body.WorkspaceID != "ws_local" || body.AppID != "app_hermes" || body.DeviceID != "dev_123" || !body.QueueingAllowed {
				t.Fatalf("unexpected grant body: %#v", body)
			}
			if strings.Join(body.AllowedChannels, ",") != "hermes.task.create,hermes.task.cancel,hermes.task.status" {
				t.Fatalf("unexpected grant channels: %#v", body.AllowedChannels)
			}
			_, _ = w.Write([]byte(`{"grant_id":"grant_hermes","status":"active","grant":{"id":"grant_hermes","app_id":"app_hermes","device_id":"dev_123","allowed_channels":["hermes.task.create","hermes.task.cancel","hermes.task.status"],"status":"active"}}`))
		default:
			http.Error(w, "not found", http.StatusNotFound)
		}
	}))
	defer server.Close()

	home := t.TempDir()
	err := runDeviceCLI([]string{"register", "--server", server.URL, "--home", home, "--workspace", "ws_local", "--name", "Hermes Mac", "--with-hermes"})
	if err != nil {
		t.Fatal(err)
	}
	if devicePublicKey == "" || appPublicKey == "" || devicePublicKey == appPublicKey {
		t.Fatalf("expected distinct device/app public keys, device=%q app=%q", devicePublicKey, appPublicKey)
	}
	deviceConfig, err := readDeviceConfig(home)
	if err != nil {
		t.Fatal(err)
	}
	appConfig := readTestAppConfig(t, home, "app_hermes")
	for _, key := range []string{"MUSUBI_APP_ID", "MUSUBI_APP_KEY_ID", "MUSUBI_API_KEY", "MUSUBI_APP_PRIVATE_KEY", "app_private_key", "app_api_key"} {
		if appConfig[key] == "" {
			t.Fatalf("app config missing %s: %#v", key, appConfig)
		}
	}
	if appConfig["MUSUBI_APP_ID"] != "app_hermes" || appConfig["grant_id"] != "grant_hermes" {
		t.Fatalf("unexpected app config: %#v", appConfig)
	}
	if deviceConfig.DevicePrivateKey == appConfig["app_private_key"] {
		t.Fatal("device private key and Hermes app private key must be distinct")
	}
	policy, err := readLocalPolicy(home)
	if err != nil {
		t.Fatal(err)
	}
	if !contains(policy.Apps["app_hermes"].Plugins["hermes"].Allow, "hermes.task.status") {
		t.Fatalf("policy missing Hermes channels: %#v", policy.Apps["app_hermes"].Plugins["hermes"].Allow)
	}
	if got := strings.Join(requests, "\n"); !strings.Contains(got, "POST /v1/devices/register") || !strings.Contains(got, "POST /v1/apps/app_hermes/api-keys") || !strings.Contains(got, "POST /v1/grants") {
		t.Fatalf("setup did not call expected endpoints:\n%s", got)
	}
}

func TestDeviceRegisterWithStartRunsDeviceLoopAfterSetup(t *testing.T) {
	var startedHome string
	originalStart := startDeviceLoop
	startDeviceLoop = func(args []string) error {
		if len(args) == 2 && args[0] == "--home" {
			startedHome = args[1]
		}
		return nil
	}
	defer func() { startDeviceLoop = originalStart }()

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		switch {
		case r.Method == "POST" && r.URL.Path == "/v1/devices/register":
			_, _ = w.Write([]byte(`{"device_id":"dev_start","device_key_id":"devkey_start","relay_url":"ws://127.0.0.1:8787/v1/devices/dev_start/connect"}`))
		default:
			http.Error(w, "not found", http.StatusNotFound)
		}
	}))
	defer server.Close()

	home := t.TempDir()
	if err := runDeviceCLI([]string{"register", "--server", server.URL, "--home", home, "--workspace", "ws_local", "--name", "Start Mac", "--start"}); err != nil {
		t.Fatal(err)
	}
	if startedHome != home {
		t.Fatalf("expected start loop for %q, got %q", home, startedHome)
	}
}

func TestHermesInitUsesExistingDeviceConfig(t *testing.T) {
	var sawDeviceID string
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		switch {
		case r.Method == "POST" && r.URL.Path == "/v1/apps":
			_, _ = w.Write([]byte(`{"app_id":"app_existing","app_key_id":"appkey_existing","status":"active"}`))
		case r.Method == "POST" && r.URL.Path == "/v1/apps/app_existing/api-keys":
			_, _ = w.Write([]byte(`{"api_key":"musubi_app_sk_existing","key":{"id":"apikey_existing","status":"active"}}`))
		case r.Method == "POST" && r.URL.Path == "/v1/grants":
			var body struct {
				DeviceID string `json:"device_id"`
			}
			_ = json.NewDecoder(r.Body).Decode(&body)
			sawDeviceID = body.DeviceID
			_, _ = w.Write([]byte(`{"grant_id":"grant_existing","status":"active","grant":{"id":"grant_existing"}}`))
		default:
			http.Error(w, "not found", http.StatusNotFound)
		}
	}))
	defer server.Close()

	home := t.TempDir()
	if err := writeDeviceConfig(home, deviceConfig{
		WorkspaceID:      "ws_local",
		DeviceID:         "dev_existing",
		DeviceKeyID:      "devkey_existing",
		DeviceName:       "Existing Mac",
		ServerURL:        server.URL,
		RelayURL:         "ws://127.0.0.1:8787/v1/devices/dev_existing/connect",
		DevicePrivateKey: "device_private",
		DevicePublicKey:  "device_public",
	}); err != nil {
		t.Fatal(err)
	}
	if err := runHermesInitCLI([]string{"--server", server.URL, "--home", home, "--workspace", "ws_local"}); err != nil {
		t.Fatal(err)
	}
	if sawDeviceID != "dev_existing" {
		t.Fatalf("expected grant for existing device, got %q", sawDeviceID)
	}
	if config := readTestAppConfig(t, home, "app_existing"); config["MUSUBI_API_KEY"] != "musubi_app_sk_existing" {
		t.Fatalf("unexpected existing-device app config: %#v", config)
	}
}

func TestHermesInitWithStartRunsDeviceLoopAfterSetup(t *testing.T) {
	var startedHome string
	originalStart := startDeviceLoop
	startDeviceLoop = func(args []string) error {
		if len(args) == 2 && args[0] == "--home" {
			startedHome = args[1]
		}
		return nil
	}
	defer func() { startDeviceLoop = originalStart }()

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		switch {
		case r.Method == "POST" && r.URL.Path == "/v1/apps":
			_, _ = w.Write([]byte(`{"app_id":"app_start","app_key_id":"appkey_start","status":"active"}`))
		case r.Method == "POST" && r.URL.Path == "/v1/apps/app_start/api-keys":
			_, _ = w.Write([]byte(`{"api_key":"musubi_app_sk_start","key":{"id":"apikey_start","status":"active"}}`))
		case r.Method == "POST" && r.URL.Path == "/v1/grants":
			_, _ = w.Write([]byte(`{"grant_id":"grant_start","status":"active","grant":{"id":"grant_start"}}`))
		default:
			http.Error(w, "not found", http.StatusNotFound)
		}
	}))
	defer server.Close()

	home := t.TempDir()
	if err := writeDeviceConfig(home, deviceConfig{
		WorkspaceID: "ws_local",
		DeviceID:    "dev_start",
		ServerURL:   server.URL,
	}); err != nil {
		t.Fatal(err)
	}
	if err := runHermesInitCLI([]string{"--server", server.URL, "--home", home, "--workspace", "ws_local", "--start"}); err != nil {
		t.Fatal(err)
	}
	if startedHome != home {
		t.Fatalf("expected start loop for %q, got %q", home, startedHome)
	}
}

func TestMergeHermesLocalPolicyPreservesUnrelatedEntries(t *testing.T) {
	home := t.TempDir()
	initial := []byte(`version: m1
apps:
  app_other:
    name: Other App
    plugins:
      echo:
        allow:
          - echo.echo
plugins:
  echo:
    enabled: true
    permissions:
      - process.spawn
`)
	if err := os.WriteFile(filepath.Join(home, "policy.yaml"), initial, 0600); err != nil {
		t.Fatal(err)
	}
	if err := mergeHermesLocalPolicy(home, "app_hermes"); err != nil {
		t.Fatal(err)
	}
	policy, err := readLocalPolicy(home)
	if err != nil {
		t.Fatal(err)
	}
	if !contains(policy.Apps["app_other"].Plugins["echo"].Allow, "echo.echo") {
		t.Fatalf("unrelated app policy was not preserved: %#v", policy.Apps)
	}
	if !policy.Plugins["echo"].Enabled || !contains(policy.Plugins["echo"].Permissions, "process.spawn") {
		t.Fatalf("unrelated plugin policy was not preserved: %#v", policy.Plugins)
	}
	if !policy.Plugins["hermes"].Enabled || !contains(policy.Apps["app_hermes"].Plugins["hermes"].Allow, "hermes.task.create") {
		t.Fatalf("Hermes policy was not merged: %#v", policy)
	}
}

func readTestAppConfig(t *testing.T, home string, appID string) map[string]string {
	t.Helper()
	configBytes, err := os.ReadFile(filepath.Join(home, "apps", appID+".json"))
	if err != nil {
		t.Fatal(err)
	}
	var config map[string]string
	if err := json.Unmarshal(configBytes, &config); err != nil {
		t.Fatal(err)
	}
	return config
}
