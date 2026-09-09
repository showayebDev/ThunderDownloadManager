package downloader

import (
	"context"
	"io"
	"sync"
	"time"
)

// SpeedLimiter provides a thread-safe token bucket rate limiter for bandwidth throttling.
type SpeedLimiter struct {
	mu           sync.Mutex
	limit        int64     // Bytes per second. If <= 0, rate limiting is disabled (unlimited).
	tokens       float64   // Available tokens (bytes)
	lastCheck    time.Time // Last time tokens were refilled
	maxBurstSize float64   // Maximum burst accumulation
	isExplicit   bool      // True if explicitly set or disabled for a specific download task
}

// NewSpeedLimiter creates a new SpeedLimiter with the specified bytes-per-second limit.
func NewSpeedLimiter(bytesPerSec int64) *SpeedLimiter {
	l := &SpeedLimiter{}
	l.SetLimit(bytesPerSec)
	return l
}

// SetLimit dynamically updates the bandwidth limit in bytes per second.
func (l *SpeedLimiter) SetLimit(bytesPerSec int64) {
	if l == nil {
		return
	}
	l.mu.Lock()
	defer l.mu.Unlock()

	l.limit = bytesPerSec
	l.lastCheck = time.Now()

	if bytesPerSec > 0 {
		// Cap burst accumulation at 250ms worth of data or min 64KB, max 1MB
		burst := float64(bytesPerSec) * 0.25
		if burst < 64*1024 {
			burst = 64 * 1024
		} else if burst > 1024*1024 {
			burst = 1024 * 1024
		}
		l.maxBurstSize = burst
		l.tokens = burst // Start with a full burst window for responsiveness
	} else {
		l.tokens = 0
		l.maxBurstSize = 0
	}
}

// SetExplicitLimit marks this limiter as an explicit task-level setting (either > 0 or 0 for unlimited).
func (l *SpeedLimiter) SetExplicitLimit(bytesPerSec int64) {
	if l == nil {
		return
	}
	l.SetLimit(bytesPerSec)
	l.mu.Lock()
	l.isExplicit = true
	l.mu.Unlock()
}

// SetDefaultLimit marks this limiter as a default (non-explicit) limiter that shares the global limit.
func (l *SpeedLimiter) SetDefaultLimit(bytesPerSec int64) {
	if l == nil {
		return
	}
	l.SetLimit(bytesPerSec)
	l.mu.Lock()
	l.isExplicit = false
	l.mu.Unlock()
}

// IsExplicit returns whether this limiter has an explicit task-level override.
func (l *SpeedLimiter) IsExplicit() bool {
	if l == nil {
		return false
	}
	l.mu.Lock()
	defer l.mu.Unlock()
	return l.isExplicit
}

// GetLimit returns the current bytes-per-second limit.
func (l *SpeedLimiter) GetLimit() int64 {
	if l == nil {
		return 0
	}
	l.mu.Lock()
	defer l.mu.Unlock()
	return l.limit
}

// Wait blocks until permission to transfer n bytes is granted or ctx is canceled.
func (l *SpeedLimiter) Wait(ctx context.Context, n int) error {
	if l == nil || n <= 0 {
		return nil
	}

	for {
		select {
		case <-ctx.Done():
			return ctx.Err()
		default:
		}

		l.mu.Lock()
		limit := l.limit
		if limit <= 0 {
			l.mu.Unlock()
			return nil
		}

		now := time.Now()
		elapsed := now.Sub(l.lastCheck).Seconds()
		l.lastCheck = now

		// Refill tokens based on elapsed time
		l.tokens += elapsed * float64(limit)
		if l.tokens > l.maxBurstSize {
			l.tokens = l.maxBurstSize
		}

		// Check if we have enough tokens to fulfill the transfer
		needed := float64(n)
		if l.tokens >= needed {
			l.tokens -= needed
			l.mu.Unlock()
			return nil
		}

		// Calculate sleep time required to accrue the missing tokens
		deficit := needed - l.tokens
		sleepSeconds := deficit / float64(limit)
		l.mu.Unlock()

		if sleepSeconds > 0 {
			sleepDuration := time.Duration(sleepSeconds * float64(time.Second))
			// Cap individual sleep steps at 100ms to ensure rapid responsiveness when limits update
			if sleepDuration > 100*time.Millisecond {
				sleepDuration = 100 * time.Millisecond
			}

			timer := time.NewTimer(sleepDuration)
			select {
			case <-ctx.Done():
				timer.Stop()
				return ctx.Err()
			case <-timer.C:
				// Re-loop and check tokens
			}
		}
	}
}

// speedLimitedReader wraps an io.Reader and throttles read calls through a SpeedLimiter.
type speedLimitedReader struct {
	ctx     context.Context
	r       io.Reader
	limiter *SpeedLimiter
}

// LimitReader wraps r to throttle reads through limiter.
func LimitReader(ctx context.Context, r io.Reader, limiter *SpeedLimiter) io.Reader {
	return &speedLimitedReader{
		ctx:     ctx,
		r:       r,
		limiter: limiter,
	}
}

func (lr *speedLimitedReader) Read(p []byte) (int, error) {
	n, err := lr.r.Read(p)
	if n > 0 {
		if lr.limiter != nil && lr.limiter.IsExplicit() {
			if lr.limiter.GetLimit() > 0 {
				if waitErr := lr.limiter.Wait(lr.ctx, n); waitErr != nil {
					return n, waitErr
				}
			}
			// If explicitly disabled (0), bypass global limiter completely!
		} else {
			if lr.limiter != nil && lr.limiter.GetLimit() > 0 {
				if waitErr := lr.limiter.Wait(lr.ctx, n); waitErr != nil {
					return n, waitErr
				}
			}
			if gl := GetEngine().GetGlobalLimiter(); gl != nil && gl.GetLimit() > 0 {
				if waitErr := gl.Wait(lr.ctx, n); waitErr != nil {
					return n, waitErr
				}
			}
		}
	}
	return n, err
}
