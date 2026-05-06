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
	body, err := json.Marshal(request)
	if err != nil {
		return err
	}
	resp, err := http.Post(strings.TrimRight(*serverURL, "/")+"/v1/apps", "application/json", bytes.NewReader(body))
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		responseBody, _ := io.ReadAll(resp.Body)
		return fmt.Errorf("create app failed: %s %s", resp.Status, string(responseBody))
	}
	var response struct {
		AppID    string `json:"app_id"`
		AppKeyID string `json:"app_key_id"`
		Status   string `json:"status"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&response); err != nil {
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

func postJSON(url string, request interface{}, response interface{}) error {
	body, err := json.Marshal(request)
	if err != nil {
		return err
	}
	resp, err := http.Post(url, "application/json", bytes.NewReader(body))
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		responseBody, _ := io.ReadAll(resp.Body)
		return fmt.Errorf("post %s failed: %s %s", url, resp.Status, string(responseBody))
	}
	if response == nil {
		return nil
	}
	return json.NewDecoder(resp.Body).Decode(response)
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
		return errors.New("usage: musubi device register --server <url> [--home <path>] [--workspace <id>] [--name <device name>]")
	}
	flags := flag.NewFlagSet("device register", flag.ContinueOnError)
	serverURL := flags.String("server", "http://127.0.0.1:8787", "Musubi server URL")
	home := flags.String("home", defaultMusubiHome(), "Musubi home directory")
	workspaceID := flags.String("workspace", "ws_local", "workspace ID")
	deviceName := flags.String("name", hostname(), "device name")
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
		plugins = append(plugins, map[string]interface{}{
			"name":        manifest.Name,
			"version":     manifest.Version,
			"channels":    manifest.Channels,
			"permissions": manifest.Permissions,
			"manifest": map[string]interface{}{
				"name":        manifest.Name,
				"version":     manifest.Version,
				"description": manifest.Description,
				"runtime":     manifest.Runtime,
				"entry":       manifest.Entry,
				"channels":    manifest.Channels,
				"permissions": manifest.Permissions,
			},
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
	if len(args) < 2 || args[0] != "run" {
		return errors.New("usage: musubi plugin run <name> --payload <path>")
	}
	name := args[1]
	flags := flag.NewFlagSet("plugin run", flag.ContinueOnError)
	payloadPath := flags.String("payload", "", "payload JSON file")
	if err := flags.Parse(args[2:]); err != nil {
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
