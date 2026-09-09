package downloader

import (
	"context"
	"fmt"
	"io"
	"math/rand"
	"net/http"
	"os"
	"time"
)

// DownloadChunk downloads a specific byte range directly into the pre-allocated target file using WriteAt.
func DownloadChunk(ctx context.Context, url string, chunk *ChunkState, file *os.File, client *http.Client, limiter *SpeedLimiter, onFallback func(*ChunkState), opts ...string) error {
	if client == nil {
		client = SharedHTTPClient
	}

	var authUser, authPass, userAgent, referer, cookies string
	if len(opts) > 0 {
		authUser = opts[0]
	}
	if len(opts) > 1 {
		authPass = opts[1]
	}
	if len(opts) > 2 {
		userAgent = opts[2]
	}
	if len(opts) > 3 {
		referer = opts[3]
	}
	if len(opts) > 4 {
		cookies = opts[4]
	}

	cfg := GetEngineConfig()
	if userAgent == "" && cfg.UserAgent != "" {
		userAgent = cfg.UserAgent
	}

	maxRetries := cfg.MaxRetries
	if maxRetries <= 0 {
		maxRetries = 3
	}

	buf := make([]byte, 64*1024) // 64KB stack-allocated buffer
	var lastErr error

	for attempt := 0; attempt < maxRetries; attempt++ {
		select {
		case <-ctx.Done():
			return ctx.Err()
		default:
		}

		if attempt > 0 {
			// Exponential backoff with jitter: 200ms, 400ms, 800ms, 1600ms...
			backoff := time.Duration(1<<attempt)*150*time.Millisecond + time.Duration(rand.Intn(100))*time.Millisecond
			select {
			case <-ctx.Done():
				return ctx.Err()
			case <-time.After(backoff):
			}
		}

		currentByte := chunk.GetCurrentByte()
		endByte := chunk.GetEndByte()

		// If chunk already reached its targeted range boundary
		if endByte > 0 && currentByte > endByte {
			chunk.SetStatus(StatusFinished)
			return nil
		}

		if ctx.Err() != nil {
			return ctx.Err()
		}

		req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
		if err != nil {
			if ctx.Err() != nil {
				return ctx.Err()
			}
			chunk.SetStatus(StatusError)
			return err
		}

		// Apply HTTP Authentication and Headers
		if authUser != "" || authPass != "" {
			req.SetBasicAuth(authUser, authPass)
		}
		if userAgent != "" {
			req.Header.Set("User-Agent", userAgent)
		}
		if referer != "" {
			req.Header.Set("Referer", referer)
		}
		if cookies != "" {
			req.Header.Set("Cookie", cookies)
		}

		// Configure Range header
		if endByte > 0 {
			req.Header.Set("Range", fmt.Sprintf("bytes=%d-%d", currentByte, endByte))
		} else if currentByte > 0 {
			req.Header.Set("Range", fmt.Sprintf("bytes=%d-", currentByte))
		}

		resp, err := client.Do(req)
		if err != nil {
			if ctx.Err() != nil {
				return ctx.Err()
			}
			lastErr = err
			// Network error, retry
			continue
		}

		isFull200OK := false

		// Check status code
		if resp.StatusCode == http.StatusOK {
			isFull200OK = true
			if chunk.ID != 0 {
				// Server ignored Range header on multi-part download and returned 200 OK.
				// Chunk 0 will stream the entire file from byte 0 to EOF.
				resp.Body.Close()
				if ctx.Err() != nil {
					return ctx.Err()
				}
				chunk.SetStatus(StatusFinished)
				if endByte > 0 {
					chunk.SetCurrentByte(endByte + 1)
				}
				return nil
			}

			// Chunk 0: Server returned full 200 OK response.
			if onFallback != nil {
				onFallback(chunk)
			}
			if currentByte > 0 {
				// Server does not support Range/resuming and sent full body from byte 0.
				// Reset currentByte to 0 to download cleanly without corruption.
				currentByte = 0
				chunk.SetCurrentByte(0)
			}
		} else if resp.StatusCode != http.StatusPartialContent {
			resp.Body.Close()
			if ctx.Err() != nil {
				return ctx.Err()
			}
			if resp.StatusCode == http.StatusTooManyRequests || resp.StatusCode >= 500 {
				lastErr = fmt.Errorf("HTTP %d (%s)", resp.StatusCode, http.StatusText(resp.StatusCode))
				// Throttled or temporary server error, retry with backoff
				continue
			}
			// Permanent client/auth error (401, 403, 404, etc.)
			chunk.SetStatus(StatusError)
			return fmt.Errorf("HTTP %d (%s)", resp.StatusCode, http.StatusText(resp.StatusCode))
		}

		readSuccess := false
		// Inactivity watchdog: closes response body if no bytes received for 20 seconds
		readWatchdog := time.AfterFunc(20*time.Second, func() {
			_ = resp.Body.Close()
		})

		for {
			select {
			case <-ctx.Done():
				readWatchdog.Stop()
				resp.Body.Close()
				return ctx.Err()
			default:
			}

			// Dynamically check end byte in case of chunk split (only when not streaming full 200 OK body)
			dynamicEnd := chunk.GetEndByte()
			if !isFull200OK && dynamicEnd > 0 && currentByte > dynamicEnd {
				readWatchdog.Stop()
				resp.Body.Close()
				chunk.SetStatus(StatusFinished)
				return nil // Worker finished its section early due to split
			}

			n, readErr := resp.Body.Read(buf)
			if n > 0 {
				readSuccess = true
				readWatchdog.Reset(20 * time.Second)

				if limiter != nil && limiter.IsExplicit() {
					if limiter.GetLimit() > 0 {
						if waitErr := limiter.Wait(ctx, n); waitErr != nil {
							readWatchdog.Stop()
							resp.Body.Close()
							return waitErr
						}
					}
					// If explicitly disabled (0), bypass global limiter completely
				} else {
					if limiter != nil && limiter.GetLimit() > 0 {
						if waitErr := limiter.Wait(ctx, n); waitErr != nil {
							readWatchdog.Stop()
							resp.Body.Close()
							return waitErr
						}
					}
					if gl := GetEngine().GetGlobalLimiter(); gl != nil && gl.GetLimit() > 0 {
						if waitErr := gl.Wait(ctx, n); waitErr != nil {
							readWatchdog.Stop()
							resp.Body.Close()
							return waitErr
						}
					}
				}

				writeCount := n
				if !isFull200OK && dynamicEnd > 0 && currentByte+int64(n)-1 > dynamicEnd {
					writeCount = int(dynamicEnd - currentByte + 1)
				}

				if writeCount > 0 {
					_, writeErr := file.WriteAt(buf[:writeCount], currentByte)
					if writeErr != nil {
						readWatchdog.Stop()
						resp.Body.Close()
						if ctx.Err() != nil {
							return ctx.Err()
						}
						chunk.SetStatus(StatusError)
						return fmt.Errorf("failed to write to file: %w", writeErr)
					}
					currentByte += int64(writeCount)
					chunk.SetCurrentByte(currentByte)
				}

				if !isFull200OK && dynamicEnd > 0 && currentByte > dynamicEnd {
					readWatchdog.Stop()
					resp.Body.Close()
					chunk.SetStatus(StatusFinished)
					return nil
				}
				if isFull200OK && dynamicEnd > 0 && currentByte > dynamicEnd {
					readWatchdog.Stop()
					resp.Body.Close()
					chunk.SetStatus(StatusFinished)
					return nil
				}
			}

			if readErr != nil {
				readWatchdog.Stop()
				resp.Body.Close()
				if ctx.Err() != nil {
					return ctx.Err()
				}
				if readErr == io.EOF {
					if dynamicEnd > 0 && currentByte > dynamicEnd {
						chunk.SetStatus(StatusFinished)
						return nil
					}
					if dynamicEnd <= 0 {
						chunk.SetEndByte(currentByte - 1)
						chunk.SetStatus(StatusFinished)
						return nil
					}
					lastErr = io.ErrUnexpectedEOF
					break
				}
				lastErr = readErr
				// Break to retry loop if unexpected stream drop
				break
			}
		}
		readWatchdog.Stop()

		// If we made real progress before a drop and still have retries, back off attempt counter slightly
		if readSuccess && attempt > 0 {
			attempt--
		}
	}

	if ctx.Err() != nil {
		return ctx.Err()
	}

	// Retries exhausted without finishing
	lastEnd := chunk.GetEndByte()
	if lastEnd > 0 && chunk.GetCurrentByte() > lastEnd {
		chunk.SetStatus(StatusFinished)
		return nil
	} else if ctx.Err() == nil {
		chunk.SetStatus(StatusError)
		if lastErr != nil {
			return lastErr
		}
		return fmt.Errorf("download failed after %d attempts", maxRetries)
	}
	return ctx.Err()
}
