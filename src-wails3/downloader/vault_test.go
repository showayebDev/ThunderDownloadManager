package downloader

import (
	"testing"
)

func TestMatchVaultCredentials(t *testing.T) {
	UpdateEngineConfig(EngineConfig{
		VaultItems: []VaultItem{
			{
				Host: "localhost:3000",
				User: "123",
				Pass: "123",
			},
		},
	})
	// Tests matching logic with test URLs
	u, p := MatchVaultCredentials("http://localhost:3000/gora%20and%20baire.mp4")
	t.Logf("Matched credentials for localhost:3000 -> user: %s, pass: %s", u, p)
	if u != "123" || p != "123" {
		t.Errorf("Expected user=123, pass=123 from vault, got user=%s, pass=%s", u, p)
	}
}
