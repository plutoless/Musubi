package main

import (
	"bufio"
	"bytes"
	"crypto/aes"
	"crypto/cipher"
	"crypto/ecdh"
	"crypto/ed25519"
	"crypto/rand"
	"crypto/sha1"
	"crypto/sha256"
	"crypto/tls"
	"crypto/x509"
	"encoding/base64"
	"encoding/binary"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"io"
	"log"
	"net"
	"net/http"
	"net/url"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"time"

	"gopkg.in/yaml.v3"
)

const (
	workspaceID = "ws_demo"
	appID       = "app_demo"
	deviceID    = "dev_demo"
)

var (
	deviceRequestKey = mustHexKey("0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef")
	appResultKey     = mustHexKey("abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789")
	allowedChannels  = map[string]bool{"echo.echo": true, "echo.ping": true}
	activeMusubiHome = ""
	startDeviceLoop  = runStartCLI
)

type MessageEnvelope struct {
	MessageID       string            `json:"message_id"`
	WorkspaceID     string            `json:"workspace_id"`
	AppID           string            `json:"app_id"`
	DeviceID        string            `json:"device_id"`
	Channel         string            `json:"channel"`
	VisibleMetadata map[string]string `json:"visible_metadata,omitempty"`
	Metadata        struct {
		TraceID    string `json:"trace_id"`
		TTLSeconds int    `json:"ttl_seconds"`
		CreatedAt  string `json:"created_at"`
	} `json:"metadata"`
	Encryption struct {
		Alg   string `json:"alg"`
		KeyID string `json:"key_id"`
	} `json:"encryption"`
	Crypto struct {
		Version        string `json:"version"`
		Alg            string `json:"alg"`
		SenderKeyID    string `json:"sender_key_id"`
		RecipientKeyID string `json:"recipient_key_id"`
	} `json:"crypto"`
	Ciphertext string `json:"ciphertext"`
}

type ResultEnvelope struct {
	MessageID   string `json:"message_id"`
	WorkspaceID string `json:"workspace_id"`
	AppID       string `json:"app_id"`
	DeviceID    string `json:"device_id"`
	Channel     string `json:"channel"`
	Status      string `json:"status"`
	Encryption  struct {
		Alg   string `json:"alg"`
		KeyID string `json:"key_id"`
	} `json:"encryption"`
	Crypto struct {
		Version        string `json:"version"`
		Alg            string `json:"alg"`
		SenderKeyID    string `json:"sender_key_id"`
		RecipientKeyID string `json:"recipient_key_id"`
	} `json:"crypto"`
	Ciphertext string `json:"ciphertext"`
}

type DeviceStatusUpdate struct {
	Type      string `json:"type"`
	MessageID string `json:"message_id"`
	Status    string `json:"status"`
}

type AppPayload struct {
	Type  string `json:"type"`
	Nonce string `json:"nonce,omitempty"`
	Body  struct {
		Text          string                 `json:"text,omitempty"`
		Instruction   string                 `json:"instruction,omitempty"`
		WorkspaceHint string                 `json:"workspace_hint,omitempty"`
		Mode          string                 `json:"mode,omitempty"`
		Stream        bool                   `json:"stream,omitempty"`
		Limits        map[string]interface{} `json:"limits,omitempty"`
		PluginOptions map[string]interface{} `json:"codex_options,omitempty"`
	} `json:"body"`
}

type PluginResultPayload struct {
	Type string           `json:"type"`
	Body PluginResultBody `json:"body"`
}

type PluginResultBody struct {
	OK        bool                   `json:"ok"`
	Echo      string                 `json:"echo,omitempty"`
	Pong      bool                   `json:"pong,omitempty"`
	HandledBy string                 `json:"handled_by"`
	TaskID    string                 `json:"task_id,omitempty"`
	EventType string                 `json:"event_type,omitempty"`
	Status    string                 `json:"status,omitempty"`
	Message   string                 `json:"message,omitempty"`
	Timestamp string                 `json:"timestamp,omitempty"`
	ErrorCode string                 `json:"error_code,omitempty"`
	ExitCode  *int                   `json:"exit_code,omitempty"`
	TimedOut  bool                   `json:"timed_out,omitempty"`
	Metadata  map[string]interface{} `json:"metadata,omitempty"`
}

type messageHandleResult struct {
	Status string           `json:"status"`
	Body   PluginResultBody `json:"body"`
}

type encryptedBox struct {
	Nonce string `json:"nonce"`
	Tag   string `json:"tag"`
	Data  string `json:"data"`
}

type jsonRPCRequest struct {
	JSONRPC string      `json:"jsonrpc"`
	ID      int         `json:"id"`
	Method  string      `json:"method"`
	Params  interface{} `json:"params"`
}

type jsonRPCResponse struct {
	JSONRPC string              `json:"jsonrpc"`
	ID      int                 `json:"id"`
	Result  PluginResultPayload `json:"result"`
	Error   *struct {
		Code    int    `json:"code"`
		Message string `json:"message"`
	} `json:"error,omitempty"`
}

type genericJSONRPCResponse struct {
	JSONRPC string          `json:"jsonrpc"`
	ID      int             `json:"id"`
	Result  json.RawMessage `json:"result"`
	Error   *struct {
		Code    int    `json:"code"`
		Message string `json:"message"`
	} `json:"error,omitempty"`
}

type genericJSONRPCNotification struct {
	JSONRPC string          `json:"jsonrpc"`
	Method  string          `json:"method"`
	Params  json.RawMessage `json:"params"`
}

type pluginCallResult struct {
	Final  PluginResultPayload
	Status string
	Events []PluginResultPayload
}

type pluginManifest struct {
	Name        string   `json:"name"`
	Version     string   `json:"version"`
	Description string   `json:"description"`
	Runtime     string   `json:"runtime"`
	Entry       string   `json:"entry"`
	Channels    []string `json:"channels"`
	Permissions []string `json:"permissions"`
	Publisher   struct {
		ID    string `json:"id"`
		Name  string `json:"name"`
		Trust string `json:"trust"`
	} `json:"publisher"`
	EventChannels []string               `json:"event_channels"`
	ConfigSchema  map[string]interface{} `json:"config_schema"`
}

type workspacePluginPolicy struct {
	RequireSignature                     bool     `json:"require_signature"`
	AllowedTrustLevels                   []string `json:"allowed_trust_levels"`
	AllowedPlugins                       []string `json:"allowed_plugins"`
	BlockedPlugins                       []string `json:"blocked_plugins"`
	RequireApprovalForPermissionIncrease bool     `json:"require_approval_for_permission_increase"`
}

type workspacePluginPolicyResponse struct {
	Policy workspacePluginPolicy `json:"policy"`
}

type registryPluginResponse struct {
	Plugin registryPluginPackage `json:"plugin"`
}

type registryPluginPackage struct {
	Name             string          `json:"name"`
	Version          string          `json:"version"`
	Publisher        pluginPublisher `json:"publisher"`
	Manifest         pluginManifest  `json:"manifest"`
	PackageURL       string          `json:"package_url"`
	PackageDigest    string          `json:"package_digest"`
	SignedPayload    string          `json:"signed_payload"`
	Signature        string          `json:"signature"`
	SigningKeyID     string          `json:"signing_key_id"`
	SigningPublicKey string          `json:"signing_public_key"`
	SignatureStatus  string          `json:"signature_status"`
}

type pluginPublisher struct {
	ID    string `json:"id"`
	Name  string `json:"name"`
	Trust string `json:"trust"`
}

type pluginInstallRecord struct {
	Name            string   `json:"name"`
	Version         string   `json:"version"`
	PublisherID     string   `json:"publisher_id"`
	PublisherName   string   `json:"publisher_name"`
	TrustLevel      string   `json:"trust_level"`
	SignatureStatus string   `json:"signature_status"`
	SigningKeyID    string   `json:"signing_key_id"`
	InstallSource   string   `json:"install_source"`
	Channels        []string `json:"channels"`
	Permissions     []string `json:"permissions"`
	PackageDigest   string   `json:"package_digest"`
	InstalledAt     string   `json:"installed_at"`
}

type localPolicy struct {
	Version string                       `json:"version" yaml:"version"`
	Apps    map[string]localPolicyApp    `json:"apps" yaml:"apps"`
	Plugins map[string]localPolicyPlugin `json:"plugins" yaml:"plugins"`
}

type localPolicyApp struct {
	Name    string                          `json:"name" yaml:"name"`
	Plugins map[string]localPolicyAppPlugin `json:"plugins" yaml:"plugins"`
}

type localPolicyAppPlugin struct {
	Allow                  []string `json:"allow" yaml:"allow"`
	RequireLocalConfirm    bool     `json:"require_local_confirm" yaml:"require_local_confirm"`
	MaxTaskDurationSeconds int      `json:"max_task_duration_seconds" yaml:"max_task_duration_seconds"`
	AllowedWorkspaceDirs   []string `json:"allowed_workspace_dirs" yaml:"allowed_workspace_dirs"`
	ApprovalMode           string   `json:"approval_mode" yaml:"approval_mode"`
	SandboxMode            string   `json:"sandbox_mode" yaml:"sandbox_mode"`
}

type localPolicyPlugin struct {
	Enabled     bool                   `json:"enabled" yaml:"enabled"`
	Permissions []string               `json:"permissions" yaml:"permissions"`
	Config      map[string]interface{} `json:"config" yaml:"config"`
}

type replayCache struct {
	ttl     time.Duration
	entries map[string]time.Time
}

type deviceConfig struct {
	WorkspaceID      string `json:"workspace_id"`
	DeviceID         string `json:"device_id"`
	DeviceKeyID      string `json:"device_key_id"`
	DeviceName       string `json:"device_name"`
	ServerURL        string `json:"server_url"`
	RelayURL         string `json:"relay_url"`
	DevicePrivateKey string `json:"device_private_key"`
	DevicePublicKey  string `json:"device_public_key"`
	AuthPrivateKey   string `json:"auth_private_key"`
	AuthPublicKey    string `json:"auth_public_key"`
}

func main() {
	if len(os.Args) > 1 && os.Args[1] == "plugin" {
		if err := runPluginCLI(os.Args[2:]); err != nil {
			log.Fatal(err)
		}
		return
	}
	if len(os.Args) > 1 && os.Args[1] == "app" {
		if err := runAppCLI(os.Args[2:]); err != nil {
			log.Fatal(err)
		}
		return
	}
	if len(os.Args) > 1 && os.Args[1] == "device" {
		if err := runDeviceCLI(os.Args[2:]); err != nil {
			log.Fatal(err)
		}
		return
	}
	if len(os.Args) > 1 && os.Args[1] == "hermes" {
		if err := runHermesCLI(os.Args[2:]); err != nil {
			log.Fatal(err)
		}
		return
	}
	if len(os.Args) > 1 && os.Args[1] == "status" {
		if err := runStatusCLI(os.Args[2:]); err != nil {
			log.Fatal(err)
		}
		return
	}
	if len(os.Args) > 1 && os.Args[1] == "start" {
		if err := runStartCLI(os.Args[2:]); err != nil {
			log.Fatal(err)
		}
		return
	}
	if len(os.Args) > 1 && os.Args[1] == "dev" {
		if err := runDevCLI(os.Args[2:]); err != nil {
			log.Fatal(err)
		}
		return
	}
	if len(os.Args) > 1 && os.Args[1] == "developer" {
		if err := runDeveloperCLI(os.Args[2:]); err != nil {
			log.Fatal(err)
		}
		return
	}

	relay := flag.String("relay", "ws://127.0.0.1:8787/v1/devices/dev_demo/connect", "relay websocket URL")
	plugin := flag.String("echo-plugin", "bun run plugins/echo/src/main.ts", "echo plugin command")
	flag.Parse()

	log.Printf("[musubi] connecting relay=%s", *relay)
	conn, err := dialWebSocket(*relay)
	if err != nil {
		log.Fatal(err)
	}
	defer conn.Close()
	log.Printf("[musubi] connected device_id=%s", deviceID)

	for {
		payload, err := conn.ReadText()
		if err != nil {
			log.Fatal(err)
		}
		var envelope MessageEnvelope
		if err := json.Unmarshal(payload, &envelope); err != nil {
			log.Printf("[musubi] invalid envelope: %v", err)
			continue
		}
		log.Printf("[musubi] received message_id=%s channel=%s ciphertext_bytes=%d", envelope.MessageID, envelope.Channel, len(envelope.Ciphertext))
		if err := conn.WriteJSON(DeviceStatusUpdate{Type: "device.status", MessageID: envelope.MessageID, Status: "received"}); err != nil {
			log.Fatal(err)
		}
		if allowedChannels[envelope.Channel] {
			if err := conn.WriteJSON(DeviceStatusUpdate{Type: "device.status", MessageID: envelope.MessageID, Status: "processing"}); err != nil {
				log.Fatal(err)
			}
		}
		result := handleEnvelope(envelope, *plugin)
		out, _ := json.Marshal(result)
		if err := conn.WriteText(out); err != nil {
			log.Fatal(err)
		}
	}
}

func runDeveloperCLI(args []string) error {
	if len(args) >= 2 && args[0] == "hermes" && args[1] == "setup" {
		return runDeveloperHermesSetupCLI(args[2:])
	}
	return errors.New("usage: musubi developer hermes setup --server <url> --home <path> --workspace <id> --developer-name <name> --developer-email <email> --publisher-name <name> --app-name <name> [--env]")
}

var hermesDefaultChannels = []string{"hermes.task.create", "hermes.task.cancel", "hermes.task.status"}

const hermesCompanionAppName = "Hermes Companion"

func runDeveloperHermesSetupCLI(args []string) error {
	flags := flag.NewFlagSet("developer hermes setup", flag.ContinueOnError)
	serverURL := flags.String("server", "http://127.0.0.1:8787", "Musubi server URL")
	home := flags.String("home", filepath.Join(defaultMusubiHome(), "hermes-companion"), "Musubi app home directory")
	workspaceID := flags.String("workspace", "ws_local", "workspace ID")
	developerName := flags.String("developer-name", "Local Hermes Developer", "developer display name")
	developerEmail := flags.String("developer-email", "dev@example.test", "developer email")
	publisherName := flags.String("publisher-name", "Local Hermes Publisher", "publisher display name")
	appName := flags.String("app-name", "Hermes Companion", "third-party app name")
	printEnv := flags.Bool("env", false, "print SDK environment variables")
	if err := flags.Parse(args); err != nil {
		return err
	}
	if strings.TrimSpace(*serverURL) == "" {
		return errors.New("--server is required")
	}

	privateKey, err := ecdh.X25519().GenerateKey(rand.Reader)
	if err != nil {
		return err
	}
	publicKey := privateKey.PublicKey()

	setup, err := createHermesDeveloperSetup(*serverURL, *workspaceID, *developerName, *developerEmail, *publisherName, *appName, base64.StdEncoding.EncodeToString(publicKey.Bytes()))
	if err != nil {
		return err
	}

	appConfig := map[string]string{
		"workspace_id":        *workspaceID,
		"app_id":              setup.AppID,
		"app_key_id":          setup.AppKeyID,
		"app_api_key_id":      setup.APIKeyID,
		"app_name":            *appName,
		"server_url":          *serverURL,
		"app_private_key":     base64.StdEncoding.EncodeToString(privateKey.Bytes()),
		"app_public_key":      base64.StdEncoding.EncodeToString(publicKey.Bytes()),
		"app_api_key":         setup.APIKey,
		"developer_id":        setup.DeveloperID,
		"publisher_id":        setup.PublisherID,
		"permission_id":       setup.PermissionDeclarationID,
		"consent_request_id":  setup.ConsentRequestID,
		"consent_url":         setup.ConsentURL,
		"server_key_scope":    "hermes-third-party-local",
		"declared_channels":   strings.Join(hermesDefaultChannels, ","),
		"queueing_requested":  "true",
		"private_key_storage": "local-only",
	}
	if err := writeAppConfig(*home, setup.AppID, appConfig); err != nil {
		return err
	}

	if *printEnv {
		fmt.Printf("MUSUBI_API_BASE_URL=%s\n", *serverURL)
		fmt.Printf("MUSUBI_APP_ID=%s\n", setup.AppID)
		fmt.Printf("MUSUBI_APP_KEY_ID=%s\n", setup.AppKeyID)
		fmt.Printf("MUSUBI_API_KEY=%s\n", setup.APIKey)
		fmt.Printf("MUSUBI_APP_PRIVATE_KEY=%s\n", appConfig["app_private_key"])
		fmt.Printf("MUSUBI_WORKSPACE_ID=%s\n", *workspaceID)
		fmt.Printf("MUSUBI_CONSENT_URL=%s\n", setup.ConsentURL)
		return nil
	}
	fmt.Printf("created Hermes third-party app %s with app key %s and api key %s\n", setup.AppID, setup.AppKeyID, setup.APIKeyID)
	fmt.Printf("declared Hermes channels: %s\n", strings.Join(hermesDefaultChannels, ", "))
	fmt.Printf("consent URL: %s\n", setup.ConsentURL)
	fmt.Printf("app config written to %s\n", filepath.Join(*home, "apps", setup.AppID+".json"))
	return nil
}

type hermesDeveloperSetup struct {
	DeveloperID             string
	PublisherID             string
	AppID                   string
	AppKeyID                string
	APIKey                  string
	APIKeyID                string
	PermissionDeclarationID string
	ConsentRequestID        string
	ConsentURL              string
}

func createHermesDeveloperSetup(serverURL string, workspaceID string, developerName string, developerEmail string, publisherName string, appName string, publicKey string) (hermesDeveloperSetup, error) {
	base := strings.TrimRight(serverURL, "/")
	var developer struct {
		Developer struct {
			ID string `json:"id"`
		} `json:"developer"`
	}
	if err := postJSON(base+"/v1/developers", map[string]interface{}{"name": developerName, "email": developerEmail}, &developer); err != nil {
		return hermesDeveloperSetup{}, err
	}

	var publisher struct {
		Publisher struct {
			ID string `json:"id"`
		} `json:"publisher"`
	}
	if err := postJSON(base+"/v1/publishers", map[string]interface{}{
		"developer_id": developer.Developer.ID,
		"display_name": publisherName,
	}, &publisher); err != nil {
		return hermesDeveloperSetup{}, err
	}

	var app struct {
		AppID        string `json:"app_id"`
		AppKeyID     string `json:"app_key_id"`
		APIKey       string `json:"api_key"`
		APIKeyRecord struct {
			ID string `json:"id"`
		} `json:"api_key_record"`
	}
	if err := postJSON(base+"/v1/developer/apps", map[string]interface{}{
		"workspace_id":  workspaceID,
		"name":          appName,
		"publisher_id":  publisher.Publisher.ID,
		"public_key":    publicKey,
		"redirect_uris": []string{base + "/control-plane"},
	}, &app); err != nil {
		return hermesDeveloperSetup{}, err
	}
	if app.AppID == "" || app.AppKeyID == "" || app.APIKey == "" {
		return hermesDeveloperSetup{}, errors.New("developer app response missing app id, app key id, or api key")
	}

	var declaration struct {
		Declaration struct {
			ID string `json:"id"`
		} `json:"declaration"`
	}
	if err := postJSON(base+"/v1/developer/apps/"+app.AppID+"/permission-declarations", map[string]interface{}{
		"plugin_name":        "hermes",
		"channels":           hermesDefaultChannels,
		"reason":             "Allow Hermes Companion to create, cancel, and read status for approved local Hermes tasks.",
		"queueing_requested": true,
	}, &declaration); err != nil {
		return hermesDeveloperSetup{}, err
	}

	var consent struct {
		ConsentRequestID string `json:"consent_request_id"`
		ConsentURL       string `json:"consent_url"`
		ConsentRequest   struct {
			ID string `json:"id"`
		} `json:"consent_request"`
	}
	if err := postJSON(base+"/v1/consent-requests", map[string]interface{}{
		"app_id": app.AppID,
		"state":  "hermes-local-setup",
		"requested_capabilities": []map[string]interface{}{{
			"plugin":   "hermes",
			"channels": hermesDefaultChannels,
			"reason":   "Allow Hermes Companion to invoke approved Hermes task channels on your selected Mac.",
		}},
	}, &consent); err != nil {
		return hermesDeveloperSetup{}, err
	}
	consentID := consent.ConsentRequestID
	if consentID == "" {
		consentID = consent.ConsentRequest.ID
	}
	consentURL := absoluteControlPlaneURL(base, consent.ConsentURL)

	return hermesDeveloperSetup{
		DeveloperID:             developer.Developer.ID,
		PublisherID:             publisher.Publisher.ID,
		AppID:                   app.AppID,
		AppKeyID:                app.AppKeyID,
		APIKey:                  app.APIKey,
		APIKeyID:                app.APIKeyRecord.ID,
		PermissionDeclarationID: declaration.Declaration.ID,
		ConsentRequestID:        consentID,
		ConsentURL:              consentURL,
	}, nil
}

func runDevCLI(args []string) error {
	if len(args) >= 3 && args[0] == "echo" && args[1] == "send" {
		return runDevEchoSend(args[2:])
	}
	if len(args) < 3 || args[0] != "app" || args[1] != "create" {
		return errors.New("usage: musubi dev app create <name> --server <url> [--home <path>] [--workspace <id>]")
	}
	name := args[2]
	flags := flag.NewFlagSet("dev app create", flag.ContinueOnError)
	serverURL := flags.String("server", "http://127.0.0.1:8787", "Musubi server URL")
	home := flags.String("home", defaultMusubiHome(), "Musubi home directory")
	workspaceID := flags.String("workspace", "ws_local", "workspace ID")
	if err := flags.Parse(args[3:]); err != nil {
		return err
	}

	privateKey, err := ecdh.X25519().GenerateKey(rand.Reader)
	if err != nil {
		return err
	}
	publicKey := privateKey.PublicKey()
	request := map[string]interface{}{
		"workspace_id": *workspaceID,
		"name":         name,
		"type":         "first_party",
		"public_key":   base64.StdEncoding.EncodeToString(publicKey.Bytes()),
	}
	var response struct {
		AppID    string `json:"app_id"`
		AppKeyID string `json:"app_key_id"`
		Status   string `json:"status"`
	}
	if err := postJSON(strings.TrimRight(*serverURL, "/")+"/v1/apps", request, &response); err != nil {
		return err
	}

	appDir := filepath.Join(*home, "apps")
	if err := os.MkdirAll(appDir, 0700); err != nil {
		return err
	}
	appConfig := map[string]string{
		"workspace_id":     *workspaceID,
		"app_id":           response.AppID,
		"app_key_id":       response.AppKeyID,
		"app_name":         name,
		"server_url":       *serverURL,
		"app_private_key":  base64.StdEncoding.EncodeToString(privateKey.Bytes()),
		"app_public_key":   base64.StdEncoding.EncodeToString(publicKey.Bytes()),
		"server_key_scope": "dev-local",
	}
	bytes, err := json.MarshalIndent(appConfig, "", "  ")
	if err != nil {
		return err
	}
	path := filepath.Join(appDir, response.AppID+".json")
	if err := os.WriteFile(path, bytes, 0600); err != nil {
		return err
	}

	fmt.Printf("created app %s with key %s\n", response.AppID, response.AppKeyID)
	fmt.Printf("dev app private key written to %s\n", path)
	return nil
}

func runAppCLI(args []string) error {
	if len(args) < 2 || args[0] != "create" {
		return errors.New("usage: musubi app create <name> --server <url> [--home <path>] [--workspace <id>] [--type user_owned] [--generate-key-local] [--env]")
	}
	name := args[1]
	flags := flag.NewFlagSet("app create", flag.ContinueOnError)
	serverURL := flags.String("server", "http://127.0.0.1:8787", "Musubi server URL")
	home := flags.String("home", defaultMusubiHome(), "Musubi home directory")
	workspaceID := flags.String("workspace", "ws_local", "workspace ID")
	appType := flags.String("type", "user_owned", "app type")
	generateKeyLocal := flags.Bool("generate-key-local", true, "generate app private key locally")
	printEnv := flags.Bool("env", false, "print SDK environment variables")
	apiKeyName := flags.String("api-key-name", "Local SDK key", "API key name")
	if err := flags.Parse(args[2:]); err != nil {
		return err
	}
	if *appType != "user_owned" && *appType != "first_party" {
		return errors.New("app type must be user_owned or first_party")
	}
	if !*generateKeyLocal {
		return errors.New("M3 local app creation requires --generate-key-local")
	}

	privateKey, err := ecdh.X25519().GenerateKey(rand.Reader)
	if err != nil {
		return err
	}
	publicKey := privateKey.PublicKey()
	createResponse, err := createRelayApp(*serverURL, *workspaceID, name, *appType, base64.StdEncoding.EncodeToString(publicKey.Bytes()))
	if err != nil {
		return err
	}
	apiKeyResponse, err := createRelayAppAPIKey(*serverURL, createResponse.AppID, *apiKeyName)
	if err != nil {
		return err
	}

	appDir := filepath.Join(*home, "apps")
	if err := os.MkdirAll(appDir, 0700); err != nil {
		return err
	}
	appConfig := map[string]string{
		"workspace_id":     *workspaceID,
		"app_id":           createResponse.AppID,
		"app_key_id":       createResponse.AppKeyID,
		"app_api_key_id":   apiKeyResponse.Key.ID,
		"app_name":         name,
		"server_url":       *serverURL,
		"app_private_key":  base64.StdEncoding.EncodeToString(privateKey.Bytes()),
		"app_public_key":   base64.StdEncoding.EncodeToString(publicKey.Bytes()),
		"app_api_key":      apiKeyResponse.APIKey,
		"server_key_scope": "app-sdk-local",
	}
	bytes, err := json.MarshalIndent(appConfig, "", "  ")
	if err != nil {
		return err
	}
	path := filepath.Join(appDir, createResponse.AppID+".json")
	if err := os.WriteFile(path, bytes, 0600); err != nil {
		return err
	}

	if *printEnv {
		fmt.Printf("MUSUBI_API_BASE_URL=%s\n", *serverURL)
		fmt.Printf("MUSUBI_APP_ID=%s\n", createResponse.AppID)
		fmt.Printf("MUSUBI_APP_KEY_ID=%s\n", createResponse.AppKeyID)
		fmt.Printf("MUSUBI_API_KEY=%s\n", apiKeyResponse.APIKey)
		fmt.Printf("MUSUBI_APP_PRIVATE_KEY=%s\n", appConfig["app_private_key"])
		return nil
	}
	fmt.Printf("created app %s with app key %s and api key %s\n", createResponse.AppID, createResponse.AppKeyID, apiKeyResponse.Key.ID)
	fmt.Printf("app private key written to %s\n", path)
	return nil
}

type createRelayAppResponse struct {
	AppID    string `json:"app_id"`
	AppKeyID string `json:"app_key_id"`
	Status   string `json:"status"`
}

type createRelayAppAPIKeyResponse struct {
	APIKey string `json:"api_key"`
	Key    struct {
		ID     string `json:"id"`
		Prefix string `json:"prefix"`
		Status string `json:"status"`
	} `json:"key"`
}

func createRelayApp(serverURL string, workspaceID string, name string, appType string, publicKey string) (createRelayAppResponse, error) {
	request := map[string]interface{}{
		"workspace_id": workspaceID,
		"name":         name,
		"type":         appType,
		"public_key":   publicKey,
	}
	var response createRelayAppResponse
	if err := postJSON(strings.TrimRight(serverURL, "/")+"/v1/apps", request, &response); err != nil {
		return createRelayAppResponse{}, err
	}
	return response, nil
}

func createRelayAppAPIKey(serverURL string, appID string, name string) (createRelayAppAPIKeyResponse, error) {
	var response createRelayAppAPIKeyResponse
	if err := postJSON(strings.TrimRight(serverURL, "/")+"/v1/apps/"+appID+"/api-keys", map[string]interface{}{"name": name}, &response); err != nil {
		return createRelayAppAPIKeyResponse{}, err
	}
	return response, nil
}

type createRelayGrantResponse struct {
	GrantID string `json:"grant_id"`
	Status  string `json:"status"`
	Grant   struct {
		ID              string   `json:"id"`
		AppID           string   `json:"app_id"`
		DeviceID        string   `json:"device_id"`
		AllowedChannels []string `json:"allowed_channels"`
		Status          string   `json:"status"`
	} `json:"grant"`
}

type localHermesSetup struct {
	AppID         string
	AppKeyID      string
	APIKeyID      string
	APIKey        string
	AppPrivateKey string
	AppPublicKey  string
	GrantID       string
	ConfigPath    string
	PolicyPath    string
	ServerURL     string
	WorkspaceID   string
	DeviceHome    string
	DeviceID      string
	StartCommand  string
}

func setupLocalHermesCompanion(serverURL string, home string, workspaceID string, config deviceConfig) (localHermesSetup, error) {
	privateKey, err := ecdh.X25519().GenerateKey(rand.Reader)
	if err != nil {
		return localHermesSetup{}, err
	}
	publicKey := privateKey.PublicKey()
	appPrivateKey := base64.StdEncoding.EncodeToString(privateKey.Bytes())
	appPublicKey := base64.StdEncoding.EncodeToString(publicKey.Bytes())

	createResponse, err := createRelayApp(serverURL, workspaceID, hermesCompanionAppName, "user_owned", appPublicKey)
	if err != nil {
		return localHermesSetup{}, err
	}
	apiKeyResponse, err := createRelayAppAPIKey(serverURL, createResponse.AppID, "Hermes Companion local key")
	if err != nil {
		return localHermesSetup{}, err
	}
	grantResponse, err := createRelayGrant(serverURL, workspaceID, createResponse.AppID, config.DeviceID, hermesDefaultChannels)
	if err != nil {
		return localHermesSetup{}, err
	}

	appConfig := map[string]string{
		"workspace_id":              workspaceID,
		"app_id":                    createResponse.AppID,
		"app_key_id":                createResponse.AppKeyID,
		"app_api_key_id":            apiKeyResponse.Key.ID,
		"app_name":                  hermesCompanionAppName,
		"server_url":                serverURL,
		"app_private_key":           appPrivateKey,
		"app_public_key":            appPublicKey,
		"app_api_key":               apiKeyResponse.APIKey,
		"grant_id":                  grantResponse.GrantID,
		"server_key_scope":          "hermes-user-owned-local",
		"declared_channels":         strings.Join(hermesDefaultChannels, ","),
		"private_key_storage":       "local-only",
		"MUSUBI_API_BASE_URL":       serverURL,
		"MUSUBI_APP_ID":             createResponse.AppID,
		"MUSUBI_APP_KEY_ID":         createResponse.AppKeyID,
		"MUSUBI_API_KEY":            apiKeyResponse.APIKey,
		"MUSUBI_APP_PRIVATE_KEY":    appPrivateKey,
		"MUSUBI_WORKSPACE_ID":       workspaceID,
		"MUSUBI_HERMES_DEVICE_ID":   config.DeviceID,
		"MUSUBI_HERMES_GRANT_ID":    grantResponse.GrantID,
		"MUSUBI_HERMES_POLICY":      filepath.Join(home, "policy.yaml"),
		"MUSUBI_HERMES_DEVICE_HOME": home,
	}
	if err := writeAppConfig(home, createResponse.AppID, appConfig); err != nil {
		return localHermesSetup{}, err
	}
	if err := mergeHermesLocalPolicy(home, createResponse.AppID); err != nil {
		return localHermesSetup{}, err
	}

	setup := localHermesSetup{
		AppID:         createResponse.AppID,
		AppKeyID:      createResponse.AppKeyID,
		APIKeyID:      apiKeyResponse.Key.ID,
		APIKey:        apiKeyResponse.APIKey,
		AppPrivateKey: appPrivateKey,
		AppPublicKey:  appPublicKey,
		GrantID:       grantResponse.GrantID,
		ConfigPath:    filepath.Join(home, "apps", createResponse.AppID+".json"),
		PolicyPath:    filepath.Join(home, "policy.yaml"),
		ServerURL:     serverURL,
		WorkspaceID:   workspaceID,
		DeviceHome:    home,
		DeviceID:      config.DeviceID,
	}
	setup.StartCommand = fmt.Sprintf("go run ./cmd/musubi start --home %s", shellEnvQuote(home))
	return setup, nil
}

func createRelayGrant(serverURL string, workspaceID string, appID string, deviceID string, channels []string) (createRelayGrantResponse, error) {
	var response createRelayGrantResponse
	if err := postJSON(strings.TrimRight(serverURL, "/")+"/v1/grants", map[string]interface{}{
		"workspace_id":     workspaceID,
		"app_id":           appID,
		"device_id":        deviceID,
		"allowed_channels": channels,
		"queueing_allowed": true,
		"name":             "Hermes Companion local grant",
		"description":      "Allow the user-owned Hermes Companion app to invoke approved Hermes task channels on this device.",
	}, &response); err != nil {
		return createRelayGrantResponse{}, err
	}
	if response.GrantID == "" {
		response.GrantID = response.Grant.ID
	}
	if response.GrantID == "" {
		return createRelayGrantResponse{}, errors.New("grant response missing grant id")
	}
	return response, nil
}

func printLocalHermesSetup(setup localHermesSetup) {
	fmt.Printf("created local Hermes Companion app %s with app key %s and api key %s\n", setup.AppID, setup.AppKeyID, setup.APIKeyID)
	fmt.Printf("created active Hermes grant %s for device %s\n", setup.GrantID, setup.DeviceID)
	fmt.Printf("MUSUBI_APP_ID=%s\n", setup.AppID)
	fmt.Printf("MUSUBI_APP_KEY_ID=%s\n", setup.AppKeyID)
	fmt.Printf("MUSUBI_API_KEY=%s\n", setup.APIKey)
	fmt.Printf("MUSUBI_APP_PRIVATE_KEY=%s\n", setup.AppPrivateKey)
	fmt.Printf("local app config written to %s\n", setup.ConfigPath)
	fmt.Printf("local policy merged at %s\n", setup.PolicyPath)
	fmt.Printf("configure your separate Hermes companion app with the SDK config at %s\n", setup.ConfigPath)
	fmt.Printf("device start command:\n%s\n", setup.StartCommand)
}

func mergeHermesLocalPolicy(home string, appID string) error {
	policyPath := filepath.Join(home, "policy.yaml")
	policy := localPolicy{
		Version: "m1",
		Apps:    map[string]localPolicyApp{},
		Plugins: map[string]localPolicyPlugin{},
	}
	if bytes, err := os.ReadFile(policyPath); err == nil && len(bytes) > 0 {
		if err := yaml.Unmarshal(bytes, &policy); err != nil {
			return err
		}
	} else if err != nil && !errors.Is(err, os.ErrNotExist) {
		return err
	}
	if policy.Version == "" {
		policy.Version = "m1"
	}
	if policy.Version != "m1" {
		return errors.New("unsupported policy version")
	}
	if policy.Apps == nil {
		policy.Apps = map[string]localPolicyApp{}
	}
	if policy.Plugins == nil {
		policy.Plugins = map[string]localPolicyPlugin{}
	}

	app := policy.Apps[appID]
	if app.Name == "" {
		app.Name = hermesCompanionAppName
	}
	if app.Plugins == nil {
		app.Plugins = map[string]localPolicyAppPlugin{}
	}
	appHermes := app.Plugins["hermes"]
	appHermes.Allow = mergeStringList(appHermes.Allow, hermesDefaultChannels)
	appHermes.RequireLocalConfirm = false
	if appHermes.MaxTaskDurationSeconds == 0 {
		appHermes.MaxTaskDurationSeconds = 14400
	}
	app.Plugins["hermes"] = appHermes
	policy.Apps[appID] = app

	plugin := policy.Plugins["hermes"]
	plugin.Enabled = true
	plugin.Permissions = mergeStringList(plugin.Permissions, []string{"process.spawn", "fs.read.project", "fs.write.project", "network.outbound"})
	policy.Plugins["hermes"] = plugin

	if err := os.MkdirAll(home, 0700); err != nil {
		return err
	}
	bytes, err := yaml.Marshal(policy)
	if err != nil {
		return err
	}
	return os.WriteFile(policyPath, bytes, 0600)
}

func mergeStringList(existing []string, additions []string) []string {
	seen := map[string]bool{}
	merged := make([]string, 0, len(existing)+len(additions))
	for _, value := range existing {
		if value == "" || seen[value] {
			continue
		}
		seen[value] = true
		merged = append(merged, value)
	}
	for _, value := range additions {
		if value == "" || seen[value] {
			continue
		}
		seen[value] = true
		merged = append(merged, value)
	}
	return merged
}

func shellEnvQuote(value string) string {
	if value == "" {
		return "''"
	}
	if strings.ContainsAny(value, " \t\n'\"$`\\") {
		return "'" + strings.ReplaceAll(value, "'", "'\\''") + "'"
	}
	return value
}

func postJSON(url string, request interface{}, response interface{}) error {
	body, err := json.Marshal(request)
	if err != nil {
		return err
	}
	resp, err := postJSONRequest(url, body, "")
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode == http.StatusUnauthorized {
		responseBody, _ := io.ReadAll(resp.Body)
		if strings.Contains(string(responseBody), "admin session required") {
			cookie, loginErr := loginLocalAdmin(url)
			if loginErr != nil {
				return loginErr
			}
			resp, err = postJSONRequest(url, body, cookie)
			if err != nil {
				return err
			}
			defer resp.Body.Close()
		} else {
			return fmt.Errorf("post %s failed: %s %s", url, resp.Status, string(responseBody))
		}
	}
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		responseBody, _ := io.ReadAll(resp.Body)
		return fmt.Errorf("post %s failed: %s %s", url, resp.Status, string(responseBody))
	}
	if response == nil {
		return nil
	}
	return json.NewDecoder(resp.Body).Decode(response)
}

func postJSONRequest(target string, body []byte, cookie string) (*http.Response, error) {
	req, err := http.NewRequest(http.MethodPost, target, bytes.NewReader(body))
	if err != nil {
		return nil, err
	}
	req.Header.Set("Content-Type", "application/json")
	if cookie != "" {
		req.Header.Set("Cookie", cookie)
	}
	return http.DefaultClient.Do(req)
}

func loginLocalAdmin(target string) (string, error) {
	parsed, err := url.Parse(target)
	if err != nil {
		return "", err
	}
	parsed.Path = "/v1/admin/login"
	parsed.RawQuery = ""
	username := os.Getenv("MUSUBI_ADMIN_USERNAME")
	if username == "" {
		username = "admin"
	}
	password := os.Getenv("MUSUBI_ADMIN_PASSWORD")
	if password == "" {
		password = "musubi-admin-local"
	}
	body, err := json.Marshal(map[string]string{"username": username, "password": password})
	if err != nil {
		return "", err
	}
	resp, err := postJSONRequest(parsed.String(), body, "")
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()
	responseBody, _ := io.ReadAll(resp.Body)
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return "", fmt.Errorf("admin login failed: %s %s", resp.Status, string(responseBody))
	}
	for _, cookie := range resp.Cookies() {
		if cookie.Name == "musubi_admin_session" {
			return cookie.String(), nil
		}
	}
	return "", errors.New("admin login did not return session cookie")
}

func runDevEchoSend(args []string) error {
	flags := flag.NewFlagSet("dev echo send", flag.ContinueOnError)
	serverURL := flags.String("server", "http://127.0.0.1:8787", "Musubi server URL")
	home := flags.String("home", defaultMusubiHome(), "Musubi home directory")
	appIDFlag := flags.String("app", "app_001", "app ID")
	channel := flags.String("channel", "echo.echo", "channel")
	text := flags.String("text", "hello from m1 public key flow", "echo text")
	workspaceHint := flags.String("workspace-hint", "", "optional plugin workspace hint")
	mode := flags.String("mode", "", "optional plugin task mode")
	approvalMode := flags.String("approval-mode", "", "optional Codex approval mode")
	sandboxMode := flags.String("sandbox-mode", "", "optional Codex sandbox mode")
	maxDuration := flags.Int("max-duration", 0, "optional max task duration seconds")
	streamEvents := flags.Bool("stream", true, "request streaming task events")
	noWait := flags.Bool("no-wait", false, "send message and print message id without waiting for completion")
	waitTimeout := flags.Duration("wait-timeout", 30*time.Second, "how long to wait for message completion")
	if err := flags.Parse(args); err != nil {
		return err
	}
	deviceConfig, err := readDeviceConfig(*home)
	if err != nil {
		return err
	}
	appConfig, err := readAppConfig(*home, *appIDFlag)
	if err != nil {
		return err
	}
	appPrivate, err := decodeX25519Private(appConfig["app_private_key"])
	if err != nil {
		return err
	}
	devicePublic, err := decodeX25519Public(deviceConfig.DevicePublicKey)
	if err != nil {
		return err
	}
	nonceBytes := make([]byte, 16)
	if _, err := rand.Read(nonceBytes); err != nil {
		return err
	}
	payload := AppPayload{
		Type:  *channel,
		Nonce: base64.StdEncoding.EncodeToString(nonceBytes),
	}
	payload.Body.Text = *text
	payload.Body.Instruction = *text
	payload.Body.WorkspaceHint = *workspaceHint
	payload.Body.Mode = *mode
	payload.Body.Stream = *streamEvents
	if *maxDuration > 0 {
		payload.Body.Limits = map[string]interface{}{"max_duration_seconds": *maxDuration}
	}
	if *approvalMode != "" || *sandboxMode != "" {
		payload.Body.PluginOptions = map[string]interface{}{}
		if *approvalMode != "" {
			payload.Body.PluginOptions["approval_mode"] = *approvalMode
		}
		if *sandboxMode != "" {
			payload.Body.PluginOptions["sandbox_mode"] = *sandboxMode
		}
	}
	ciphertext, err := encryptPublicJSON(payload, appPrivate, devicePublic)
	if err != nil {
		return err
	}

	messageID := fmt.Sprintf("msg_m1_%d", time.Now().UnixMilli())
	envelope := MessageEnvelope{
		MessageID:   messageID,
		WorkspaceID: deviceConfig.WorkspaceID,
		AppID:       *appIDFlag,
		DeviceID:    deviceConfig.DeviceID,
		Channel:     *channel,
		VisibleMetadata: map[string]string{
			"app_public_key": appConfig["app_public_key"],
		},
		Ciphertext: ciphertext,
	}
	envelope.Crypto.Version = "m1"
	envelope.Crypto.Alg = "x25519-aes-256-gcm"
	envelope.Crypto.SenderKeyID = appConfig["app_key_id"]
	envelope.Crypto.RecipientKeyID = deviceConfig.DeviceKeyID

	body, err := json.Marshal(envelope)
	if err != nil {
		return err
	}
	resp, err := http.Post(strings.TrimRight(*serverURL, "/")+"/v1/messages", "application/json", bytes.NewReader(body))
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		responseBody, _ := io.ReadAll(resp.Body)
		return fmt.Errorf("send failed: %s %s", resp.Status, string(responseBody))
	}
	if *noWait {
		fmt.Printf("message id %s\n", messageID)
		fmt.Println("message status delivered")
		return nil
	}

	var status struct {
		MessageID string         `json:"message_id"`
		Status    string         `json:"status"`
		History   []string       `json:"history"`
		Result    ResultEnvelope `json:"result"`
	}
	deadline := time.Now().Add(*waitTimeout)
	for {
		statusResp, err := http.Get(strings.TrimRight(*serverURL, "/") + "/v1/messages/" + messageID)
		if err != nil {
			return err
		}
		if err := json.NewDecoder(statusResp.Body).Decode(&status); err != nil {
			_ = statusResp.Body.Close()
			return err
		}
		_ = statusResp.Body.Close()
		if status.Status == "completed" || status.Status == "failed" {
			break
		}
		if time.Now().After(deadline) {
			break
		}
		time.Sleep(50 * time.Millisecond)
	}
	if status.Status != "completed" {
		fmt.Printf("message id %s\n", messageID)
		fmt.Printf("message history %v\n", status.History)
		return fmt.Errorf("message did not complete: %s", status.Status)
	}

	appPrivate, err = decodeX25519Private(appConfig["app_private_key"])
	if err != nil {
		return err
	}
	devicePublic, err = decodeX25519Public(deviceConfig.DevicePublicKey)
	if err != nil {
		return err
	}
	var result PluginResultPayload
	if err := decryptPublicJSON(status.Result.Ciphertext, appPrivate, devicePublic, &result); err != nil {
		return err
	}
	fmt.Printf("message id %s\n", messageID)
	fmt.Printf("message history %v\n", status.History)
	resultBytes, _ := json.Marshal(result)
	fmt.Printf("decrypted result %s\n", string(resultBytes))
	return nil
}

func runDeviceCLI(args []string) error {
	if len(args) == 0 || args[0] != "register" {
		return errors.New("usage: musubi device register --server <url> [--home <path>] [--workspace <id>] [--name <device name>] [--registration-token <token>] [--start]")
	}
	flags := flag.NewFlagSet("device register", flag.ContinueOnError)
	serverURL := flags.String("server", "http://127.0.0.1:8787", "Musubi server URL")
	home := flags.String("home", defaultMusubiHome(), "Musubi home directory")
	workspaceID := flags.String("workspace", "ws_local", "workspace ID")
	deviceName := flags.String("name", hostname(), "device name")
	registrationToken := flags.String("registration-token", "", "one-time user device registration token")
	withHermes := flags.Bool("with-hermes", false, "development-only: create a local user-owned Hermes Companion app, grant, and policy")
	start := flags.Bool("start", false, "start the Musubi device service after registration")
	if err := flags.Parse(args[1:]); err != nil {
		return err
	}

	privateKey, err := ecdh.X25519().GenerateKey(rand.Reader)
	if err != nil {
		return err
	}
	publicKey := privateKey.PublicKey()
	authPublic, authPrivate, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		return err
	}
	request := map[string]interface{}{
		"workspace_id":    *workspaceID,
		"device_name":     *deviceName,
		"platform":        runtime.GOOS + "-" + runtime.GOARCH,
		"cli_version":     "0.1.0",
		"public_key":      base64.StdEncoding.EncodeToString(publicKey.Bytes()),
		"auth_public_key": base64.StdEncoding.EncodeToString(authPublic),
	}
	if strings.TrimSpace(*registrationToken) != "" {
		request["registration_token"] = strings.TrimSpace(*registrationToken)
	}
	body, err := json.Marshal(request)
	if err != nil {
		return err
	}
	resp, err := http.Post(strings.TrimRight(*serverURL, "/")+"/v1/devices/register", "application/json", bytes.NewReader(body))
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		responseBody, _ := io.ReadAll(resp.Body)
		return fmt.Errorf("register failed: %s %s", resp.Status, string(responseBody))
	}
	var response struct {
		DeviceID    string `json:"device_id"`
		DeviceKeyID string `json:"device_key_id"`
		RelayURL    string `json:"relay_url"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&response); err != nil {
		return err
	}

	config := deviceConfig{
		WorkspaceID:      *workspaceID,
		DeviceID:         response.DeviceID,
		DeviceKeyID:      response.DeviceKeyID,
		DeviceName:       *deviceName,
		ServerURL:        *serverURL,
		RelayURL:         response.RelayURL,
		DevicePrivateKey: base64.StdEncoding.EncodeToString(privateKey.Bytes()),
		DevicePublicKey:  base64.StdEncoding.EncodeToString(publicKey.Bytes()),
		AuthPrivateKey:   base64.StdEncoding.EncodeToString(authPrivate),
		AuthPublicKey:    base64.StdEncoding.EncodeToString(authPublic),
	}
	if err := writeDeviceConfig(*home, config); err != nil {
		return err
	}
	fmt.Printf("registered device %s with key %s\n", response.DeviceID, response.DeviceKeyID)
	fmt.Printf("config written to %s\n", filepath.Join(*home, "config.json"))
	if *withHermes {
		fmt.Println("warning: --with-hermes is development-only; native Hermes Companion should use Musubi UI consent with loopback PKCE")
		setup, err := setupLocalHermesCompanion(*serverURL, *home, *workspaceID, config)
		if err != nil {
			return err
		}
		printLocalHermesSetup(setup)
	}
	if *start {
		fmt.Printf("starting device service for %s\n", config.DeviceID)
		return startDeviceLoop([]string{"--home", *home})
	}
	return nil
}

func runHermesCLI(args []string) error {
	if len(args) >= 1 && args[0] == "init" {
		return runHermesInitCLI(args[1:])
	}
	return errors.New("usage: musubi hermes init --server <url> --home <path> --workspace <id> [--start]")
}

func runHermesInitCLI(args []string) error {
	flags := flag.NewFlagSet("hermes init", flag.ContinueOnError)
	serverURL := flags.String("server", "", "Musubi server URL")
	home := flags.String("home", filepath.Join(defaultMusubiHome(), "hermes-device"), "Musubi device home directory")
	workspaceID := flags.String("workspace", "", "workspace ID")
	start := flags.Bool("start", false, "start the Musubi device service after Hermes setup")
	if err := flags.Parse(args); err != nil {
		return err
	}
	config, err := readDeviceConfig(*home)
	if err != nil {
		return err
	}
	if strings.TrimSpace(*serverURL) == "" {
		*serverURL = config.ServerURL
	}
	if strings.TrimSpace(*workspaceID) == "" {
		*workspaceID = config.WorkspaceID
	}
	if strings.TrimSpace(*serverURL) == "" || strings.TrimSpace(*workspaceID) == "" {
		return errors.New("--server and --workspace are required when config does not contain them")
	}
	setup, err := setupLocalHermesCompanion(*serverURL, *home, *workspaceID, config)
	if err != nil {
		return err
	}
	printLocalHermesSetup(setup)
	if *start {
		fmt.Printf("starting device service for %s\n", config.DeviceID)
		return startDeviceLoop([]string{"--home", *home})
	}
	return nil
}

func runStartCLI(args []string) error {
	flags := flag.NewFlagSet("start", flag.ContinueOnError)
	home := flags.String("home", defaultMusubiHome(), "Musubi home directory")
	if err := flags.Parse(args); err != nil {
		return err
	}
	activeMusubiHome = *home
	config, err := readDeviceConfig(*home)
	if err != nil {
		return err
	}
	if err := reportPluginCapabilities(config); err != nil {
		log.Printf("[musubi] capability report failed: %v", err)
	}
	relayURL, err := signedRelayURL(config)
	if err != nil {
		return err
	}
	log.Printf("[musubi] connecting registered device relay=%s", redactSignature(relayURL))
	conn, err := dialWebSocket(relayURL)
	if err != nil {
		return err
	}
	defer conn.Close()
	log.Printf("[musubi] connected registered device_id=%s", config.DeviceID)
	replay := newReplayCache(10 * time.Minute)
	for {
		payload, err := conn.ReadText()
		if err != nil {
			return err
		}
		var envelope MessageEnvelope
		if err := json.Unmarshal(payload, &envelope); err != nil {
			log.Printf("[musubi] invalid envelope: %v", err)
			continue
		}
		log.Printf("[musubi] received message_id=%s channel=%s ciphertext_bytes=%d", envelope.MessageID, envelope.Channel, len(envelope.Ciphertext))
		if err := conn.WriteJSON(DeviceStatusUpdate{Type: "device.status", MessageID: envelope.MessageID, Status: "received"}); err != nil {
			return err
		}
		if err := conn.WriteJSON(DeviceStatusUpdate{Type: "device.status", MessageID: envelope.MessageID, Status: "processing"}); err != nil {
			return err
		}
		results := handleRegisteredEnvelope(config, envelope, "bun run plugins/echo/src/main.ts", replay)
		for _, result := range results {
			if err := conn.WriteJSON(result); err != nil {
				return err
			}
		}
	}
}

func reportPluginCapabilities(config deviceConfig) error {
	plugins := []map[string]interface{}{}
	for _, name := range []string{"echo", "hermes", "codex"} {
		manifest, err := loadPluginManifest(name)
		if err != nil {
			return err
		}
		manifestView := map[string]interface{}{
			"name":        manifest.Name,
			"version":     manifest.Version,
			"description": manifest.Description,
			"runtime":     manifest.Runtime,
			"entry":       manifest.Entry,
			"channels":    manifest.Channels,
			"permissions": manifest.Permissions,
		}
		if installed, err := readPluginInstallRecord(activeMusubiHome, name); err == nil {
			manifestView["publisher_id"] = installed.PublisherID
			manifestView["publisher_name"] = installed.PublisherName
			manifestView["trust_level"] = installed.TrustLevel
			manifestView["signature_status"] = installed.SignatureStatus
			manifestView["signing_key_id"] = installed.SigningKeyID
			manifestView["install_source"] = installed.InstallSource
			manifestView["package_digest"] = installed.PackageDigest
		}
		plugins = append(plugins, map[string]interface{}{
			"name":        manifest.Name,
			"version":     manifest.Version,
			"channels":    manifest.Channels,
			"permissions": manifest.Permissions,
			"manifest":    manifestView,
		})
	}
	body, err := json.Marshal(map[string]interface{}{"plugins": plugins})
	if err != nil {
		return err
	}
	url := strings.TrimRight(config.ServerURL, "/") + "/v1/devices/" + config.DeviceID + "/capabilities"
	resp, err := http.Post(url, "application/json", bytes.NewReader(body))
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		responseBody, _ := io.ReadAll(resp.Body)
		return fmt.Errorf("capability report failed: %s %s", resp.Status, string(responseBody))
	}
	log.Printf("[musubi] reported plugin capabilities plugins=%d", len(plugins))
	return nil
}

func handleRegisteredEnvelope(config deviceConfig, envelope MessageEnvelope, pluginCommand string, replay *replayCache) []ResultEnvelope {
	if replay != nil && replay.Seen("message:"+envelope.MessageID, time.Now()) {
		return []ResultEnvelope{registeredFailure(config, envelope, "REPLAY_REJECTED: duplicate message_id")}
	}
	pluginName := pluginNameForChannel(envelope.Channel)
	if err := enforceLocalPolicy(config, envelope, pluginName); err != nil {
		return []ResultEnvelope{registeredFailure(config, envelope, err.Error())}
	}
	devicePrivate, err := decodeX25519Private(config.DevicePrivateKey)
	if err != nil {
		return []ResultEnvelope{registeredFailure(config, envelope, err.Error())}
	}
	appPublic, err := decodeX25519PublicFromEnvelopeSender(envelope)
	if err != nil {
		return []ResultEnvelope{registeredFailure(config, envelope, err.Error())}
	}
	var payload AppPayload
	if err := decryptPublicJSON(envelope.Ciphertext, devicePrivate, appPublic, &payload); err != nil {
		return []ResultEnvelope{registeredFailure(config, envelope, err.Error())}
	}
	if payload.Nonce != "" && replay != nil && replay.Seen("nonce:"+payload.Nonce, time.Now()) {
		return []ResultEnvelope{registeredFailure(config, envelope, "REPLAY_REJECTED: duplicate payload nonce")}
	}
	if err := enforcePayloadLocalPolicy(envelope, pluginName, payload); err != nil {
		return []ResultEnvelope{registeredFailure(config, envelope, err.Error())}
	}
	progress := registeredProgressEnvelope(config, envelope, pluginName)
	callResult, err := callPlugin(fmt.Sprintf("bun run plugins/%s/src/main.ts", pluginName), envelope.Channel, payload)
	if err != nil {
		return []ResultEnvelope{registeredFailure(config, envelope, err.Error())}
	}
	results := []ResultEnvelope{progress}
	for _, event := range callResult.Events {
		results = append(results, registeredResultEnvelope(config, envelope, "processing", event))
	}
	results = append(results, registeredResultEnvelope(config, envelope, callResult.Status, callResult.Final))
	return results
}

func newReplayCache(ttl time.Duration) *replayCache {
	return &replayCache{
		ttl:     ttl,
		entries: map[string]time.Time{},
	}
}

func (cache *replayCache) Seen(key string, now time.Time) bool {
	if key == "" {
		return false
	}
	for existingKey, seenAt := range cache.entries {
		if now.Sub(seenAt) > cache.ttl {
			delete(cache.entries, existingKey)
		}
	}
	if _, ok := cache.entries[key]; ok {
		cache.entries[key] = now
		return true
	}
	cache.entries[key] = now
	return false
}

func pluginNameForChannel(channel string) string {
	if strings.HasPrefix(channel, "hermes.") {
		return "hermes"
	}
	if strings.HasPrefix(channel, "codex.") {
		return "codex"
	}
	return "echo"
}

func enforceLocalPolicy(config deviceConfig, envelope MessageEnvelope, pluginName string) error {
	home := activeMusubiHome
	if home == "" {
		home = defaultMusubiHome()
	}
	policy, err := readLocalPolicy(home)
	if err != nil {
		return errors.New("LOCAL_POLICY_DENIED: policy missing or invalid")
	}
	app, ok := policy.Apps[envelope.AppID]
	if !ok {
		return errors.New("LOCAL_POLICY_DENIED: app not allowed")
	}
	appPlugin, ok := app.Plugins[pluginName]
	if !ok || !contains(appPlugin.Allow, envelope.Channel) {
		return errors.New("LOCAL_POLICY_DENIED: channel not allowed")
	}
	pluginPolicy, ok := policy.Plugins[pluginName]
	if !ok || !pluginPolicy.Enabled {
		return errors.New("LOCAL_POLICY_DENIED: plugin disabled")
	}
	manifest, err := loadPluginManifest(pluginName)
	if err != nil {
		return err
	}
	for _, permission := range manifest.Permissions {
		if !contains(pluginPolicy.Permissions, permission) {
			return fmt.Errorf("LOCAL_POLICY_DENIED: plugin permission %s not allowed", permission)
		}
	}
	if appPlugin.RequireLocalConfirm && !confirmLocalExecution(os.Stdin, os.Stderr, envelope, pluginName) {
		return errors.New("LOCAL_POLICY_DENIED: local confirmation rejected")
	}
	return nil
}

func enforcePayloadLocalPolicy(envelope MessageEnvelope, pluginName string, payload AppPayload) error {
	home := activeMusubiHome
	if home == "" {
		home = defaultMusubiHome()
	}
	policy, err := readLocalPolicy(home)
	if err != nil {
		return errors.New("LOCAL_POLICY_DENIED: policy missing or invalid")
	}
	appPlugin := policy.Apps[envelope.AppID].Plugins[pluginName]
	pluginPolicy := policy.Plugins[pluginName]
	if limit, ok := numericPayloadLimit(payload.Body.Limits, "max_duration_seconds"); ok && appPlugin.MaxTaskDurationSeconds > 0 && limit > appPlugin.MaxTaskDurationSeconds {
		return errors.New("LOCAL_POLICY_DENIED: task duration exceeds local policy")
	}
	if requested := stringPayloadOption(payload.Body.PluginOptions, "approval_mode"); requested != "" && appPlugin.ApprovalMode != "" && appPlugin.ApprovalMode != "codex_default" && requested != appPlugin.ApprovalMode && requested != "codex_default" {
		return errors.New("LOCAL_POLICY_DENIED: approval mode exceeds local policy")
	}
	if requested := stringPayloadOption(payload.Body.PluginOptions, "sandbox_mode"); requested != "" && appPlugin.SandboxMode != "" && appPlugin.SandboxMode != "codex_default" && requested != appPlugin.SandboxMode && requested != "codex_default" {
		return errors.New("LOCAL_POLICY_DENIED: sandbox mode exceeds local policy")
	}
	allowedDirs := append([]string{}, appPlugin.AllowedWorkspaceDirs...)
	if len(allowedDirs) == 0 {
		if configured, ok := stringSliceConfig(pluginPolicy.Config["allowed_workspace_dirs"]); ok {
			allowedDirs = configured
		}
	}
	if len(allowedDirs) == 0 {
		return nil
	}
	workspace := payload.Body.WorkspaceHint
	if workspace == "" {
		if configured, ok := pluginPolicy.Config["default_working_dir"].(string); ok {
			workspace = configured
		}
	}
	if workspace == "" {
		return errors.New("LOCAL_POLICY_DENIED: workspace required")
	}
	ok, err := pathWithinAllowedDirs(workspace, allowedDirs)
	if err != nil || !ok {
		return errors.New("WORKSPACE_NOT_ALLOWED: requested workspace is not allowed by local policy")
	}
	return nil
}

func numericPayloadLimit(values map[string]interface{}, key string) (int, bool) {
	if values == nil {
		return 0, false
	}
	switch value := values[key].(type) {
	case int:
		return value, true
	case float64:
		return int(value), true
	case string:
		var parsed int
		if _, err := fmt.Sscanf(value, "%d", &parsed); err == nil {
			return parsed, true
		}
	}
	return 0, false
}

func stringPayloadOption(values map[string]interface{}, key string) string {
	if values == nil {
		return ""
	}
	value, _ := values[key].(string)
	return value
}

func stringSliceConfig(value interface{}) ([]string, bool) {
	switch typed := value.(type) {
	case []string:
		return typed, true
	case []interface{}:
		out := []string{}
		for _, item := range typed {
			text, ok := item.(string)
			if !ok {
				return nil, false
			}
			out = append(out, text)
		}
		return out, true
	}
	return nil, false
}

func pathWithinAllowedDirs(path string, allowedDirs []string) (bool, error) {
	resolvedPath, err := resolveLocalPath(path)
	if err != nil {
		return false, err
	}
	for _, allowed := range allowedDirs {
		resolvedAllowed, err := resolveLocalPath(allowed)
		if err != nil {
			continue
		}
		if resolvedPath == resolvedAllowed || strings.HasPrefix(resolvedPath, resolvedAllowed+string(os.PathSeparator)) {
			return true, nil
		}
	}
	return false, nil
}

func resolveLocalPath(path string) (string, error) {
	if strings.HasPrefix(path, "~/") {
		home, err := os.UserHomeDir()
		if err != nil {
			return "", err
		}
		path = filepath.Join(home, strings.TrimPrefix(path, "~/"))
	}
	absolute, err := filepath.Abs(path)
	if err != nil {
		return "", err
	}
	evaluated, err := filepath.EvalSymlinks(absolute)
	if err == nil {
		return filepath.Clean(evaluated), nil
	}
	return filepath.Clean(absolute), nil
}

func confirmLocalExecution(input io.Reader, output io.Writer, envelope MessageEnvelope, pluginName string) bool {
	_, _ = fmt.Fprintf(
		output,
		"Allow app %s to run plugin %s channel %s on this device? Type yes to approve: ",
		envelope.AppID,
		pluginName,
		envelope.Channel,
	)
	scanner := bufio.NewScanner(input)
	if !scanner.Scan() {
		return false
	}
	answer := strings.ToLower(strings.TrimSpace(scanner.Text()))
	return answer == "yes" || answer == "y"
}

func readLocalPolicy(home string) (localPolicy, error) {
	bytes, err := os.ReadFile(filepath.Join(home, "policy.yaml"))
	if err != nil {
		return localPolicy{}, err
	}
	var policy localPolicy
	if err := yaml.Unmarshal(bytes, &policy); err != nil {
		return localPolicy{}, err
	}
	if policy.Version != "m1" {
		return localPolicy{}, errors.New("unsupported policy version")
	}
	if policy.Apps == nil || policy.Plugins == nil {
		return localPolicy{}, errors.New("policy missing apps or plugins")
	}
	return policy, nil
}

func registeredFailure(config deviceConfig, envelope MessageEnvelope, message string) ResultEnvelope {
	var payload PluginResultPayload
	payload.Type = "task.result"
	payload.Body.OK = false
	payload.Body.Echo = message
	payload.Body.HandledBy = "echo"
	return registeredResultEnvelope(config, envelope, "failed", payload)
}

func registeredProgressEnvelope(config deviceConfig, envelope MessageEnvelope, pluginName string) ResultEnvelope {
	var payload PluginResultPayload
	payload.Type = "task.progress"
	payload.Body.OK = true
	payload.Body.Echo = "plugin accepted message"
	payload.Body.HandledBy = pluginName
	return registeredResultEnvelope(config, envelope, "processing", payload)
}

func registeredResultEnvelope(config deviceConfig, envelope MessageEnvelope, status string, payload PluginResultPayload) ResultEnvelope {
	devicePrivate, err := decodeX25519Private(config.DevicePrivateKey)
	if err != nil {
		panic(err)
	}
	appPublic, err := decodeX25519PublicFromEnvelopeSender(envelope)
	if err != nil {
		panic(err)
	}
	ciphertext, err := encryptPublicJSON(payload, devicePrivate, appPublic)
	if err != nil {
		panic(err)
	}
	result := ResultEnvelope{
		MessageID:   envelope.MessageID,
		WorkspaceID: envelope.WorkspaceID,
		AppID:       envelope.AppID,
		DeviceID:    envelope.DeviceID,
		Channel:     resultChannelFor(envelope.Channel),
		Status:      status,
		Ciphertext:  ciphertext,
	}
	result.Crypto.Version = "m1"
	result.Crypto.Alg = "x25519-aes-256-gcm"
	result.Crypto.SenderKeyID = config.DeviceKeyID
	result.Crypto.RecipientKeyID = envelope.Crypto.SenderKeyID
	return result
}

func resultChannelFor(requestChannel string) string {
	if strings.HasPrefix(requestChannel, "hermes.") {
		return "hermes.task.event"
	}
	if strings.HasPrefix(requestChannel, "codex.") {
		return "codex.task.event"
	}
	return "echo.event"
}

func signedRelayURL(config deviceConfig) (string, error) {
	privateBytes, err := base64.StdEncoding.DecodeString(config.AuthPrivateKey)
	if err != nil {
		return "", err
	}
	ts := fmt.Sprintf("%d", time.Now().UnixMilli())
	canonical := fmt.Sprintf("GET\n/v1/devices/%s/connect\n%s", config.DeviceID, ts)
	signature := ed25519.Sign(ed25519.PrivateKey(privateBytes), []byte(canonical))
	relayURL, err := url.Parse(config.RelayURL)
	if err != nil {
		return "", err
	}
	query := relayURL.Query()
	query.Set("ts", ts)
	query.Set("sig", base64.StdEncoding.EncodeToString(signature))
	relayURL.RawQuery = query.Encode()
	return relayURL.String(), nil
}

func redactSignature(rawURL string) string {
	parsed, err := url.Parse(rawURL)
	if err != nil {
		return rawURL
	}
	query := parsed.Query()
	if query.Has("sig") {
		query.Set("sig", "redacted")
	}
	parsed.RawQuery = query.Encode()
	return parsed.String()
}

func runStatusCLI(args []string) error {
	flags := flag.NewFlagSet("status", flag.ContinueOnError)
	home := flags.String("home", defaultMusubiHome(), "Musubi home directory")
	if err := flags.Parse(args); err != nil {
		return err
	}
	config, err := readDeviceConfig(*home)
	if err != nil {
		return err
	}
	fmt.Printf("Device: %s\n", config.DeviceName)
	fmt.Printf("Device ID: %s\n", config.DeviceID)
	fmt.Printf("Workspace: %s\n", config.WorkspaceID)
	fmt.Printf("Device key: %s\n", config.DeviceKeyID)
	fmt.Printf("Relay: %s\n", config.RelayURL)
	return nil
}

func writeDeviceConfig(home string, config deviceConfig) error {
	if err := os.MkdirAll(home, 0700); err != nil {
		return err
	}
	bytes, err := json.MarshalIndent(config, "", "  ")
	if err != nil {
		return err
	}
	return os.WriteFile(filepath.Join(home, "config.json"), bytes, 0600)
}

func readDeviceConfig(home string) (deviceConfig, error) {
	bytes, err := os.ReadFile(filepath.Join(home, "config.json"))
	if err != nil {
		return deviceConfig{}, err
	}
	var config deviceConfig
	if err := json.Unmarshal(bytes, &config); err != nil {
		return deviceConfig{}, err
	}
	return config, nil
}

func readAppConfig(home string, appID string) (map[string]string, error) {
	bytes, err := os.ReadFile(filepath.Join(home, "apps", appID+".json"))
	if err != nil {
		return nil, err
	}
	var config map[string]string
	if err := json.Unmarshal(bytes, &config); err != nil {
		return nil, err
	}
	return config, nil
}

func writeAppConfig(home string, appID string, config map[string]string) error {
	appDir := filepath.Join(home, "apps")
	if err := os.MkdirAll(appDir, 0700); err != nil {
		return err
	}
	bytes, err := json.MarshalIndent(config, "", "  ")
	if err != nil {
		return err
	}
	return os.WriteFile(filepath.Join(appDir, appID+".json"), bytes, 0600)
}

func absoluteControlPlaneURL(serverURL string, value string) string {
	if value == "" {
		return ""
	}
	if strings.HasPrefix(value, "http://") || strings.HasPrefix(value, "https://") {
		return value
	}
	if strings.HasPrefix(value, "/") {
		return strings.TrimRight(serverURL, "/") + value
	}
	return strings.TrimRight(serverURL, "/") + "/" + value
}

func decodeX25519Private(value string) (*ecdh.PrivateKey, error) {
	bytes, err := base64.StdEncoding.DecodeString(value)
	if err != nil {
		return nil, err
	}
	return ecdh.X25519().NewPrivateKey(bytes)
}

func decodeX25519Public(value string) (*ecdh.PublicKey, error) {
	bytes, err := base64.StdEncoding.DecodeString(value)
	if err != nil {
		return nil, err
	}
	return ecdh.X25519().NewPublicKey(bytes)
}

func decodeX25519PublicFromEnvelopeSender(envelope MessageEnvelope) (*ecdh.PublicKey, error) {
	if envelope.VisibleMetadata == nil || envelope.VisibleMetadata["app_public_key"] == "" {
		return nil, errors.New("missing app public key metadata")
	}
	return decodeX25519Public(envelope.VisibleMetadata["app_public_key"])
}

func encryptPublicJSON(value interface{}, privateKey *ecdh.PrivateKey, peerPublicKey *ecdh.PublicKey) (string, error) {
	key, err := derivePublicBoxKey(privateKey, peerPublicKey)
	if err != nil {
		return "", err
	}
	return encryptJSON(value, key)
}

func decryptPublicJSON(ciphertext string, privateKey *ecdh.PrivateKey, peerPublicKey *ecdh.PublicKey, target interface{}) error {
	key, err := derivePublicBoxKey(privateKey, peerPublicKey)
	if err != nil {
		return err
	}
	return decryptJSON(ciphertext, key, target)
}

func derivePublicBoxKey(privateKey *ecdh.PrivateKey, peerPublicKey *ecdh.PublicKey) ([]byte, error) {
	shared, err := privateKey.ECDH(peerPublicKey)
	if err != nil {
		return nil, err
	}
	sum := sha256.Sum256(append([]byte("musubi-m1-x25519-aes-256-gcm:"), shared...))
	return sum[:], nil
}

func defaultMusubiHome() string {
	if value := os.Getenv("MUSUBI_HOME"); value != "" {
		return value
	}
	home, err := os.UserHomeDir()
	if err != nil {
		return ".musubi"
	}
	return filepath.Join(home, ".musubi")
}

func hostname() string {
	name, err := os.Hostname()
	if err != nil || name == "" {
		return "local-device"
	}
	return name
}

func runPluginCLI(args []string) error {
	if len(args) < 1 {
		return errors.New("usage: musubi plugin <run|install|update-check> ...")
	}
	switch args[0] {
	case "run":
		return runPluginRunCLI(args[1:])
	case "install":
		return runPluginInstallCLI(args[1:])
	case "update-check":
		return runPluginUpdateCheckCLI(args[1:])
	default:
		return errors.New("usage: musubi plugin <run|install|update-check> ...")
	}
}

func runPluginRunCLI(args []string) error {
	if len(args) < 1 {
		return errors.New("usage: musubi plugin run <name> --payload <path>")
	}
	name := args[0]
	flags := flag.NewFlagSet("plugin run", flag.ContinueOnError)
	payloadPath := flags.String("payload", "", "payload JSON file")
	if err := flags.Parse(args[1:]); err != nil {
		return err
	}
	if *payloadPath == "" {
		return errors.New("--payload is required")
	}

	manifest, err := loadPluginManifest(name)
	if err != nil {
		return err
	}
	payloadBytes, err := os.ReadFile(*payloadPath)
	if err != nil {
		return err
	}
	var payload map[string]interface{}
	if err := json.Unmarshal(payloadBytes, &payload); err != nil {
		return err
	}

	log.Printf("[musubi] plugin manifest loaded name=%s version=%s", manifest.Name, manifest.Version)
	info, err := callPluginJSON(manifest.Entry, jsonRPCRequest{
		JSONRPC: "2.0",
		ID:      1,
		Method:  "musubi.plugin.info",
		Params:  map[string]interface{}{},
	})
	if err != nil {
		return err
	}
	log.Printf("[musubi] plugin info %s", string(info))

	channel, _ := payload["type"].(string)
	if channel == "" {
		return errors.New("payload.type is required")
	}
	if !contains(manifest.Channels, channel) {
		return fmt.Errorf("plugin %s does not declare channel %s", manifest.Name, channel)
	}

	result, err := callPluginJSON(manifest.Entry, jsonRPCRequest{
		JSONRPC: "2.0",
		ID:      2,
		Method:  "musubi.message.handle",
		Params: map[string]interface{}{
			"message_id": "msg_local_plugin_run",
			"app_id":     "app_local",
			"channel":    channel,
			"payload":    payload,
		},
	})
	if err != nil {
		return err
	}
	log.Printf("[musubi] plugin lifecycle completed name=%s channel=%s", manifest.Name, channel)
	fmt.Println(string(result))
	return nil
}

func runPluginInstallCLI(args []string) error {
	if len(args) < 1 {
		return errors.New("usage: musubi plugin install <name> --server <url> [--home <path>] [--version latest] [--yes]")
	}
	name := args[0]
	flags := flag.NewFlagSet("plugin install", flag.ContinueOnError)
	serverURL := flags.String("server", "http://127.0.0.1:8787", "Musubi server URL")
	home := flags.String("home", defaultMusubiHome(), "Musubi home directory")
	version := flags.String("version", "latest", "plugin version")
	yes := flags.Bool("yes", false, "accept permission review")
	if err := flags.Parse(args[1:]); err != nil {
		return err
	}
	var policyResponse workspacePluginPolicyResponse
	if err := getJSON(strings.TrimRight(*serverURL, "/")+"/v1/workspace/plugin-policy", &policyResponse); err != nil {
		return err
	}
	var registryResponse registryPluginResponse
	if err := getJSON(strings.TrimRight(*serverURL, "/")+"/v1/plugin-registry/resolve?name="+url.QueryEscape(name)+"&version="+url.QueryEscape(*version), &registryResponse); err != nil {
		return err
	}
	plugin := registryResponse.Plugin
	if err := enforcePluginPolicy(policyResponse.Policy, plugin); err != nil {
		return err
	}
	if err := verifyRegistryPlugin(plugin); err != nil {
		return err
	}

	fmt.Printf("Plugin: %s\n", plugin.Name)
	fmt.Printf("Publisher: %s (%s)\n", plugin.Publisher.Name, plugin.Publisher.Trust)
	fmt.Printf("Version: %s\n", plugin.Version)
	fmt.Printf("Signature: %s\n", plugin.SignatureStatus)
	fmt.Printf("Channels: %s\n", strings.Join(plugin.Manifest.Channels, ", "))
	fmt.Printf("Requested permissions: %s\n", strings.Join(plugin.Manifest.Permissions, ", "))
	if !*yes {
		return errors.New("install requires --yes after reviewing permissions")
	}

	record := pluginInstallRecord{
		Name:            plugin.Name,
		Version:         plugin.Version,
		PublisherID:     plugin.Publisher.ID,
		PublisherName:   plugin.Publisher.Name,
		TrustLevel:      plugin.Publisher.Trust,
		SignatureStatus: plugin.SignatureStatus,
		SigningKeyID:    plugin.SigningKeyID,
		InstallSource:   "registry",
		Channels:        plugin.Manifest.Channels,
		Permissions:     plugin.Manifest.Permissions,
		PackageDigest:   plugin.PackageDigest,
		InstalledAt:     time.Now().UTC().Format(time.RFC3339),
	}
	if err := writePluginInstallRecord(*home, record); err != nil {
		return err
	}
	_ = reportInstalledPlugin(*serverURL, *home, record)
	fmt.Println("Install approved")
	fmt.Printf("installed %s@%s\n", record.Name, record.Version)
	return nil
}

func runPluginUpdateCheckCLI(args []string) error {
	if len(args) < 1 {
		return errors.New("usage: musubi plugin update-check <name> --server <url> [--home <path>]")
	}
	name := args[0]
	flags := flag.NewFlagSet("plugin update-check", flag.ContinueOnError)
	serverURL := flags.String("server", "http://127.0.0.1:8787", "Musubi server URL")
	home := flags.String("home", defaultMusubiHome(), "Musubi home directory")
	if err := flags.Parse(args[1:]); err != nil {
		return err
	}
	installed, err := readPluginInstallRecord(*home, name)
	if err != nil {
		return err
	}
	var registryResponse registryPluginResponse
	if err := getJSON(strings.TrimRight(*serverURL, "/")+"/v1/plugin-registry/resolve?name="+url.QueryEscape(name)+"&version=latest", &registryResponse); err != nil {
		return err
	}
	latest := registryResponse.Plugin
	fmt.Printf("%s %s -> %s\n", name, installed.Version, latest.Version)
	newPermissions := difference(latest.Manifest.Permissions, installed.Permissions)
	newChannels := difference(latest.Manifest.Channels, installed.Channels)
	if len(newPermissions) == 0 && len(newChannels) == 0 {
		fmt.Println("No permission increase")
		return nil
	}
	if len(newPermissions) > 0 {
		fmt.Printf("New permissions: %s\n", strings.Join(newPermissions, ", "))
	}
	if len(newChannels) > 0 {
		fmt.Printf("New channels: %s\n", strings.Join(newChannels, ", "))
	}
	return nil
}

func enforcePluginPolicy(policy workspacePluginPolicy, plugin registryPluginPackage) error {
	if contains(policy.BlockedPlugins, plugin.Name) {
		return fmt.Errorf("workspace plugin policy blocked %s", plugin.Name)
	}
	if len(policy.AllowedPlugins) > 0 && !contains(policy.AllowedPlugins, plugin.Name) {
		return fmt.Errorf("workspace plugin policy does not allow %s", plugin.Name)
	}
	if len(policy.AllowedTrustLevels) > 0 && !contains(policy.AllowedTrustLevels, plugin.Publisher.Trust) {
		return fmt.Errorf("workspace plugin policy requires trusted publisher; got %s", plugin.Publisher.Trust)
	}
	if policy.RequireSignature && (plugin.Signature == "" || plugin.SignatureStatus == "unsigned") {
		return errors.New("unsigned plugin blocked by workspace policy")
	}
	return nil
}

func verifyRegistryPlugin(plugin registryPluginPackage) error {
	sum := sha256.Sum256([]byte(plugin.SignedPayload))
	if plugin.PackageDigest != "sha256:"+fmt.Sprintf("%x", sum[:]) {
		return errors.New("package digest verification failed")
	}
	if plugin.Signature == "" {
		return errors.New("unsigned plugin blocked by default")
	}
	keyDer, err := base64.StdEncoding.DecodeString(plugin.SigningPublicKey)
	if err != nil {
		return err
	}
	publicKey, err := x509.ParsePKIXPublicKey(keyDer)
	if err != nil {
		return err
	}
	edKey, ok := publicKey.(ed25519.PublicKey)
	if !ok {
		return errors.New("plugin signing key is not Ed25519")
	}
	signature, err := base64.StdEncoding.DecodeString(plugin.Signature)
	if err != nil {
		return err
	}
	if !ed25519.Verify(edKey, []byte(plugin.SignedPayload), signature) {
		return errors.New("signature verification failed")
	}
	if plugin.SignatureStatus != "verified" {
		return fmt.Errorf("signature status is %s", plugin.SignatureStatus)
	}
	return nil
}

func getJSON(url string, response interface{}) error {
	resp, err := http.Get(url)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		responseBody, _ := io.ReadAll(resp.Body)
		return fmt.Errorf("get %s failed: %s %s", url, resp.Status, string(responseBody))
	}
	return json.NewDecoder(resp.Body).Decode(response)
}

func pluginInstallPath(home string, name string) string {
	if home == "" {
		home = defaultMusubiHome()
	}
	return filepath.Join(home, "plugins", name+".install.json")
}

func writePluginInstallRecord(home string, record pluginInstallRecord) error {
	dir := filepath.Join(home, "plugins")
	if err := os.MkdirAll(dir, 0700); err != nil {
		return err
	}
	bytes, err := json.MarshalIndent(record, "", "  ")
	if err != nil {
		return err
	}
	return os.WriteFile(pluginInstallPath(home, record.Name), bytes, 0600)
}

func readPluginInstallRecord(home string, name string) (pluginInstallRecord, error) {
	bytes, err := os.ReadFile(pluginInstallPath(home, name))
	if err != nil {
		return pluginInstallRecord{}, err
	}
	var record pluginInstallRecord
	if err := json.Unmarshal(bytes, &record); err != nil {
		return pluginInstallRecord{}, err
	}
	return record, nil
}

func reportInstalledPlugin(serverURL string, home string, record pluginInstallRecord) error {
	config, err := readDeviceConfig(home)
	if err != nil {
		return nil
	}
	return postJSON(strings.TrimRight(serverURL, "/")+"/v1/devices/"+config.DeviceID+"/plugins/report", map[string]interface{}{
		"plugins": []pluginInstallRecord{record},
	}, nil)
}

func difference(next []string, current []string) []string {
	out := []string{}
	for _, value := range next {
		if !contains(current, value) {
			out = append(out, value)
		}
	}
	return out
}

func loadPluginManifest(name string) (pluginManifest, error) {
	path := fmt.Sprintf("plugins/%s/musubi.plugin.json", name)
	bytes, err := os.ReadFile(path)
	if err != nil {
		return pluginManifest{}, err
	}
	var manifest pluginManifest
	if err := json.Unmarshal(bytes, &manifest); err != nil {
		return pluginManifest{}, err
	}
	return manifest, nil
}

func callPluginJSON(pluginCommand string, request jsonRPCRequest) (json.RawMessage, error) {
	parts := strings.Fields(pluginCommand)
	if len(parts) == 0 {
		return nil, errors.New("empty plugin command")
	}
	cmd := exec.Command(parts[0], parts[1:]...)
	stdin, err := cmd.StdinPipe()
	if err != nil {
		return nil, err
	}
	stdout, err := cmd.StdoutPipe()
	if err != nil {
		return nil, err
	}
	cmd.Stderr = os.Stderr
	if err := cmd.Start(); err != nil {
		return nil, err
	}
	defer func() {
		_ = cmd.Process.Kill()
	}()

	if err := json.NewEncoder(stdin).Encode(request); err != nil {
		return nil, err
	}
	_ = stdin.Close()

	line, err := bufio.NewReader(stdout).ReadBytes('\n')
	if err != nil {
		return nil, err
	}
	var response genericJSONRPCResponse
	if err := json.Unmarshal(bytes.TrimSpace(line), &response); err != nil {
		return nil, err
	}
	if response.Error != nil {
		return nil, errors.New(response.Error.Message)
	}
	return response.Result, nil
}

func contains(values []string, target string) bool {
	for _, value := range values {
		if value == target {
			return true
		}
	}
	return false
}

func handleEnvelope(envelope MessageEnvelope, pluginCommand string) ResultEnvelope {
	if !allowedChannels[envelope.Channel] {
		return failure(envelope, "local policy denied channel")
	}

	var payload AppPayload
	if err := decryptJSON(envelope.Ciphertext, deviceRequestKey, &payload); err != nil {
		return failure(envelope, err.Error())
	}

	callResult, err := callPlugin(pluginCommand, envelope.Channel, payload)
	if err != nil {
		return failure(envelope, err.Error())
	}

	return resultEnvelope(envelope, callResult.Status, callResult.Final)
}

func callPlugin(pluginCommand string, channel string, payload AppPayload) (pluginCallResult, error) {
	parts := strings.Fields(pluginCommand)
	if len(parts) == 0 {
		return pluginCallResult{}, errors.New("empty plugin command")
	}
	cmd := exec.Command(parts[0], parts[1:]...)
	stdin, err := cmd.StdinPipe()
	if err != nil {
		return pluginCallResult{}, err
	}
	stdout, err := cmd.StdoutPipe()
	if err != nil {
		return pluginCallResult{}, err
	}
	cmd.Stderr = os.Stderr
	if err := cmd.Start(); err != nil {
		return pluginCallResult{}, err
	}

	request := jsonRPCRequest{
		JSONRPC: "2.0",
		ID:      1,
		Method:  "musubi.message.handle",
		Params:  map[string]interface{}{"channel": channel, "payload": payload},
	}
	if err := json.NewEncoder(stdin).Encode(request); err != nil {
		return pluginCallResult{}, err
	}
	_ = stdin.Close()

	var events []PluginResultPayload
	var handled messageHandleResult
	foundResponse := false
	scanner := bufio.NewScanner(stdout)
	for scanner.Scan() {
		line := bytes.TrimSpace(scanner.Bytes())
		if len(line) == 0 {
			continue
		}
		var probe struct {
			ID     *int            `json:"id,omitempty"`
			Method string          `json:"method,omitempty"`
			Params json.RawMessage `json:"params,omitempty"`
		}
		if err := json.Unmarshal(line, &probe); err != nil {
			return pluginCallResult{}, err
		}
		if probe.Method == "musubi.message.event" {
			var event messageHandleResult
			if err := json.Unmarshal(probe.Params, &event); err != nil {
				return pluginCallResult{}, err
			}
			events = append(events, PluginResultPayload{Type: "codex.task.event", Body: event.Body})
			continue
		}
		var response genericJSONRPCResponse
		if err := json.Unmarshal(line, &response); err != nil {
			return pluginCallResult{}, err
		}
		if response.Error != nil {
			return pluginCallResult{}, errors.New(response.Error.Message)
		}
		if err := json.Unmarshal(response.Result, &handled); err != nil {
			return pluginCallResult{}, err
		}
		foundResponse = true
	}
	if err := scanner.Err(); err != nil {
		return pluginCallResult{}, err
	}
	_ = cmd.Wait()
	if !foundResponse {
		return pluginCallResult{}, errors.New("plugin did not return a JSON-RPC response")
	}
	status := handled.Status
	if status == "" {
		status = "completed"
	}
	if status != "completed" && status != "failed" {
		return pluginCallResult{}, fmt.Errorf("plugin returned unsupported status %s", status)
	}
	return pluginCallResult{
		Final:  PluginResultPayload{Type: "task.result", Body: handled.Body},
		Status: status,
		Events: events,
	}, nil
}

func failure(envelope MessageEnvelope, message string) ResultEnvelope {
	var payload PluginResultPayload
	payload.Type = "task.result"
	payload.Body.OK = false
	payload.Body.Echo = message
	payload.Body.HandledBy = "echo"
	return resultEnvelope(envelope, "failed", payload)
}

func resultEnvelope(envelope MessageEnvelope, status string, payload PluginResultPayload) ResultEnvelope {
	ciphertext, err := encryptJSON(payload, appResultKey)
	if err != nil {
		panic(err)
	}
	result := ResultEnvelope{
		MessageID:   envelope.MessageID,
		WorkspaceID: workspaceID,
		AppID:       appID,
		DeviceID:    deviceID,
		Channel:     envelope.Channel,
		Status:      status,
		Ciphertext:  ciphertext,
	}
	result.Encryption.Alg = "musubi-demo-aes-256-gcm"
	result.Encryption.KeyID = "demo-app-key"
	return result
}

func encryptJSON(value interface{}, key []byte) (string, error) {
	plain, err := json.Marshal(value)
	if err != nil {
		return "", err
	}
	block, err := aes.NewCipher(key)
	if err != nil {
		return "", err
	}
	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return "", err
	}
	nonce := make([]byte, gcm.NonceSize())
	if _, err := rand.Read(nonce); err != nil {
		return "", err
	}
	sealed := gcm.Seal(nil, nonce, plain, nil)
	tagSize := gcm.Overhead()
	box := encryptedBox{
		Nonce: base64.StdEncoding.EncodeToString(nonce),
		Tag:   base64.StdEncoding.EncodeToString(sealed[len(sealed)-tagSize:]),
		Data:  base64.StdEncoding.EncodeToString(sealed[:len(sealed)-tagSize]),
	}
	out, err := json.Marshal(box)
	if err != nil {
		return "", err
	}
	return base64.StdEncoding.EncodeToString(out), nil
}

func decryptJSON(ciphertext string, key []byte, target interface{}) error {
	raw, err := base64.StdEncoding.DecodeString(ciphertext)
	if err != nil {
		return err
	}
	var box encryptedBox
	if err := json.Unmarshal(raw, &box); err != nil {
		return err
	}
	nonce, err := base64.StdEncoding.DecodeString(box.Nonce)
	if err != nil {
		return err
	}
	data, err := base64.StdEncoding.DecodeString(box.Data)
	if err != nil {
		return err
	}
	tag, err := base64.StdEncoding.DecodeString(box.Tag)
	if err != nil {
		return err
	}
	block, err := aes.NewCipher(key)
	if err != nil {
		return err
	}
	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return err
	}
	plain, err := gcm.Open(nil, nonce, append(data, tag...), nil)
	if err != nil {
		return err
	}
	return json.Unmarshal(plain, target)
}

type webSocketConn struct {
	conn net.Conn
}

func dialWebSocket(rawURL string) (*webSocketConn, error) {
	parsed, err := url.Parse(rawURL)
	if err != nil {
		return nil, err
	}
	host := parsed.Host
	dialHost := host
	if parsed.Port() == "" {
		switch parsed.Scheme {
		case "wss":
			dialHost = net.JoinHostPort(parsed.Hostname(), "443")
		case "ws":
			dialHost = net.JoinHostPort(parsed.Hostname(), "80")
		}
	}
	var conn net.Conn
	if parsed.Scheme == "wss" {
		conn, err = dialTLSWithOptionalProxy(dialHost, parsed.Hostname())
	} else {
		conn, err = net.DialTimeout("tcp", dialHost, 5*time.Second)
	}
	if err != nil {
		return nil, err
	}
	keyBytes := make([]byte, 16)
	if _, err := rand.Read(keyBytes); err != nil {
		return nil, err
	}
	key := base64.StdEncoding.EncodeToString(keyBytes)
	path := parsed.RequestURI()
	if path == "" {
		path = "/"
	}
	reqScheme := "http"
	if parsed.Scheme == "wss" {
		reqScheme = "https"
	}
	req, _ := http.NewRequest("GET", reqScheme+"://"+host+path, nil)
	req.Host = host
	req.Header.Set("Connection", "Upgrade")
	req.Header.Set("Upgrade", "websocket")
	req.Header.Set("Sec-WebSocket-Version", "13")
	req.Header.Set("Sec-WebSocket-Key", key)
	if err := req.Write(conn); err != nil {
		return nil, err
	}
	resp, err := http.ReadResponse(bufio.NewReader(conn), req)
	if err != nil {
		return nil, err
	}
	if resp.StatusCode != http.StatusSwitchingProtocols {
		return nil, fmt.Errorf("websocket upgrade failed: %s", resp.Status)
	}
	expected := acceptKey(key)
	if resp.Header.Get("Sec-WebSocket-Accept") != expected {
		return nil, errors.New("websocket accept key mismatch")
	}
	return &webSocketConn{conn: conn}, nil
}

func dialTLSWithOptionalProxy(dialHost string, serverName string) (net.Conn, error) {
	proxyURL, err := http.ProxyFromEnvironment(&http.Request{URL: &url.URL{Scheme: "https", Host: dialHost}})
	if err != nil {
		return nil, err
	}
	dialer := &net.Dialer{Timeout: 5 * time.Second}
	var rawConn net.Conn
	if proxyURL != nil {
		proxyHost := proxyURL.Host
		if proxyURL.Port() == "" {
			proxyHost = net.JoinHostPort(proxyURL.Hostname(), "80")
		}
		rawConn, err = dialer.Dial("tcp", proxyHost)
		if err != nil {
			return nil, err
		}
		connectReq, _ := http.NewRequest("CONNECT", "https://"+dialHost, nil)
		connectReq.Host = dialHost
		if proxyURL.User != nil {
			password, _ := proxyURL.User.Password()
			token := base64.StdEncoding.EncodeToString([]byte(proxyURL.User.Username() + ":" + password))
			connectReq.Header.Set("Proxy-Authorization", "Basic "+token)
		}
		if err := connectReq.Write(rawConn); err != nil {
			_ = rawConn.Close()
			return nil, err
		}
		resp, err := http.ReadResponse(bufio.NewReader(rawConn), connectReq)
		if err != nil {
			_ = rawConn.Close()
			return nil, err
		}
		if resp.StatusCode != http.StatusOK {
			_ = rawConn.Close()
			return nil, fmt.Errorf("proxy connect failed: %s", resp.Status)
		}
	} else {
		rawConn, err = dialer.Dial("tcp", dialHost)
		if err != nil {
			return nil, err
		}
	}
	tlsConn := tls.Client(rawConn, &tls.Config{
		ServerName: serverName,
		MinVersion: tls.VersionTLS12,
	})
	if err := tlsConn.Handshake(); err != nil {
		_ = tlsConn.Close()
		return nil, err
	}
	return tlsConn, nil
}

func (w *webSocketConn) ReadText() ([]byte, error) {
	header := make([]byte, 2)
	if _, err := io.ReadFull(w.conn, header); err != nil {
		return nil, err
	}
	opcode := header[0] & 0x0f
	if opcode == 0x8 {
		return nil, io.EOF
	}
	length := int(header[1] & 0x7f)
	if length == 126 {
		var ext [2]byte
		if _, err := io.ReadFull(w.conn, ext[:]); err != nil {
			return nil, err
		}
		length = int(binary.BigEndian.Uint16(ext[:]))
	} else if length == 127 {
		var ext [8]byte
		if _, err := io.ReadFull(w.conn, ext[:]); err != nil {
			return nil, err
		}
		length = int(binary.BigEndian.Uint64(ext[:]))
	}
	payload := make([]byte, length)
	_, err := io.ReadFull(w.conn, payload)
	return payload, err
}

func (w *webSocketConn) WriteText(payload []byte) error {
	var frame bytes.Buffer
	frame.WriteByte(0x81)
	maskBit := byte(0x80)
	length := len(payload)
	if length < 126 {
		frame.WriteByte(maskBit | byte(length))
	} else if length <= 65535 {
		frame.WriteByte(maskBit | 126)
		_ = binary.Write(&frame, binary.BigEndian, uint16(length))
	} else {
		frame.WriteByte(maskBit | 127)
		_ = binary.Write(&frame, binary.BigEndian, uint64(length))
	}
	mask := make([]byte, 4)
	if _, err := rand.Read(mask); err != nil {
		return err
	}
	frame.Write(mask)
	for i, b := range payload {
		frame.WriteByte(b ^ mask[i%4])
	}
	_, err := w.conn.Write(frame.Bytes())
	return err
}

func (w *webSocketConn) WriteJSON(value interface{}) error {
	payload, err := json.Marshal(value)
	if err != nil {
		return err
	}
	return w.WriteText(payload)
}

func (w *webSocketConn) Close() error {
	return w.conn.Close()
}

func acceptKey(key string) string {
	sum := sha1.Sum([]byte(key + "258EAFA5-E914-47DA-95CA-C5AB0DC85B11"))
	return base64.StdEncoding.EncodeToString(sum[:])
}

func mustHexKey(value string) []byte {
	out := make([]byte, len(value)/2)
	for i := 0; i < len(out); i++ {
		var b byte
		_, err := fmt.Sscanf(value[i*2:i*2+2], "%02x", &b)
		if err != nil {
			panic(err)
		}
		out[i] = b
	}
	return out
}
