package downloader

import (
	"context"
	"io"
	"strings"
	"testing"
	"time"
)

func TestSpeedLimiter_Unlimited(t *testing.T) {
	limiter := NewSpeedLimiter(0)
	ctx := context.Background()

	start := time.Now()
	err := limiter.Wait(ctx, 1024*1024)
	if err != nil {
		t.Fatalf("Unexpected error: %v", err)
	}
	if time.Since(start) > 50*time.Millisecond {
		t.Errorf("Unlimited limiter should not block, took: %v", time.Since(start))
	}
}

func TestSpeedLimiter_RateThrottling(t *testing.T) {
	// Limit to 100 KB/s (102,400 bytes/sec)
	limit := int64(100 * 1024)
	limiter := NewSpeedLimiter(limit)
	ctx := context.Background()

	// Exhaust initial burst
	_ = limiter.Wait(ctx, int(limiter.maxBurstSize))

	start := time.Now()
	// Transfer 50 KB -> should take ~0.5s (500ms)
	bytesToTransfer := 50 * 1024
	err := limiter.Wait(ctx, bytesToTransfer)
	if err != nil {
		t.Fatalf("Wait failed: %v", err)
	}
	elapsed := time.Since(start)

	if elapsed < 350*time.Millisecond || elapsed > 800*time.Millisecond {
		t.Errorf("Expected ~500ms throttling, got %v", elapsed)
	}
}

func TestSpeedLimiter_DynamicLimitUpdate(t *testing.T) {
	limiter := NewSpeedLimiter(50 * 1024)
	if limiter.GetLimit() != 50*1024 {
		t.Errorf("Expected limit 50KB, got %d", limiter.GetLimit())
	}

	limiter.SetLimit(200 * 1024)
	if limiter.GetLimit() != 200*1024 {
		t.Errorf("Expected limit 200KB, got %d", limiter.GetLimit())
	}
}

func TestSpeedLimiter_LimitReader(t *testing.T) {
	data := strings.Repeat("A", 100*1024) // 100KB
	limiter := NewSpeedLimiter(200 * 1024) // 200KB/s
	ctx := context.Background()

	r := LimitReader(ctx, strings.NewReader(data), limiter)
	buf := make([]byte, 32*1024)
	totalRead := 0

	for {
		n, err := r.Read(buf)
		if n > 0 {
			totalRead += n
		}
		if err == io.EOF {
			break
		}
		if err != nil {
			t.Fatalf("Read error: %v", err)
		}
	}

	if totalRead != 100*1024 {
		t.Errorf("Expected 100KB read, got %d", totalRead)
	}
}

func TestSpeedLimiter_ExplicitOverride(t *testing.T) {
	limiter := NewSpeedLimiter(0)
	if limiter.IsExplicit() {
		t.Errorf("NewSpeedLimiter should default to not explicit")
	}

	limiter.SetExplicitLimit(500 * 1024 * 1024)
	if !limiter.IsExplicit() {
		t.Errorf("SetExplicitLimit should mark limiter as explicit")
	}
	if limiter.GetLimit() != 500*1024*1024 {
		t.Errorf("Expected limit 500MB, got %d", limiter.GetLimit())
	}

	limiter.SetExplicitLimit(0) // Explicit unlimited
	if !limiter.IsExplicit() {
		t.Errorf("SetExplicitLimit(0) should remain explicit")
	}
	if limiter.GetLimit() != 0 {
		t.Errorf("Expected limit 0, got %d", limiter.GetLimit())
	}
}
