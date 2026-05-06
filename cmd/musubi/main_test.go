package main

import (
	"bytes"
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
