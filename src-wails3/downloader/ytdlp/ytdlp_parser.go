// ytdlp_parser.go parses yt-dlp stdout progress lines, human-readable byte sizes,
// transfer speeds, ETA durations, and multi-stream accumulation states.
package ytdlp

import (
	"io"
	"os"
	"regexp"
	"strconv"
	"strings"

	"ThunderDM/src-wails3/downloader/core"
)

var (
	ytdlpResumeRegex   = regexp.MustCompile(`\[download\]\s+Resuming\s+download\s+at\s+byte\s+(\d+)`)
	ytdlpDownloadRegex = regexp.MustCompile(`\[download\]\s+([\d\.]+)%\s+of\s+~?\s*([\d\.]+\s*[A-Za-z]+)(?:\s+at\s+([\d\.]+\s*[A-Za-z/]+))?(?:\s+(?:ETA\s+([\d:]+)|in\s+([\d:]+)))?`)
	ytdlpAlreadyRegex  = regexp.MustCompile(`\[download\]\s+(.+)\s+has already been downloaded`)
)

// streamLinesFromReader reads CR/LF-delimited lines from r and invokes callback for each non-empty line.
func streamLinesFromReader(r io.Reader, callback func(line string)) {
	buf := make([]byte, 1024)
	var lineBuf strings.Builder

	for {
		n, err := r.Read(buf)
		if n > 0 {
			chunk := string(buf[:n])
			for _, ch := range chunk {
				if ch == '\r' || ch == '\n' {
					line := lineBuf.String()
					if strings.TrimSpace(line) != "" && callback != nil {
						callback(line)
					}
					lineBuf.Reset()
				} else {
					lineBuf.WriteRune(ch)
				}
			}
		}
		if err != nil {
			break
		}
	}
	if lineBuf.Len() > 0 && callback != nil {
		callback(lineBuf.String())
	}
}

// parseYTDLPLine parses a single yt-dlp stdout line into progress metrics or merging status.
func parseYTDLPLine(line string) (percent float64, totalBytes int64, downloadedBytes int64, speed float64, eta float64, isMerging bool, matched bool) {
	if strings.Contains(line, "[Merger]") ||
		strings.Contains(line, "[ExtractAudio]") ||
		strings.Contains(line, "Merging formats") ||
		strings.Contains(line, "Deleting original file") {
		return 100.0, 0, 0, 0, 0, true, true
	}

	if resMatches := ytdlpResumeRegex.FindStringSubmatch(line); len(resMatches) > 1 {
		if resByte, err := strconv.ParseInt(resMatches[1], 10, 64); err == nil && resByte > 0 {
			return 0, 0, resByte, 0, 0, false, true
		}
	}

	matches := ytdlpDownloadRegex.FindStringSubmatch(line)
	if len(matches) > 1 {
		matched = true
		p, _ := strconv.ParseFloat(matches[1], 64)
		percent = p

		if len(matches) > 2 && matches[2] != "" {
			totalBytes = parseSizeStringToBytes(matches[2])
			if totalBytes > 0 && percent > 0 {
				downloadedBytes = int64(float64(totalBytes) * (percent / 100.0))
			}
		}

		if len(matches) > 3 && matches[3] != "" {
			speed = parseSpeedStringToBytesPerSec(matches[3])
		}

		if len(matches) > 4 && matches[4] != "" {
			eta = parseETAToSeconds(matches[4])
		}
	}
	return
}

// parseSizeStringToBytes converts a yt-dlp size string (e.g. "45.2MiB", "1.2GB") to bytes.
func parseSizeStringToBytes(s string) int64 {
	return int64(parseScaledUnitValue(strings.TrimSpace(s)))
}

// parseSpeedStringToBytesPerSec converts a yt-dlp speed string (e.g. "5.4MiB/s") to bytes per second.
func parseSpeedStringToBytesPerSec(s string) float64 {
	s = strings.TrimSuffix(strings.TrimSpace(s), "/s")
	s = strings.TrimSuffix(s, "/S")
	return parseScaledUnitValue(s)
}

func parseScaledUnitValue(s string) float64 {
	if s == "" {
		return 0
	}
	var numStr strings.Builder
	var unitStr strings.Builder
	for i, r := range s {
		if (r >= '0' && r <= '9') || r == '.' {
			if unitStr.Len() == 0 {
				numStr.WriteRune(r)
			}
		} else if r != ' ' {
			unitStr.WriteString(s[i:])
			break
		}
	}

	val, err := strconv.ParseFloat(numStr.String(), 64)
	if err != nil {
		return 0
	}
	unit := strings.ToUpper(strings.TrimSpace(unitStr.String()))
	switch {
	case strings.HasPrefix(unit, "GIB") || strings.HasPrefix(unit, "GB"):
		return val * 1024 * 1024 * 1024
	case strings.HasPrefix(unit, "MIB") || strings.HasPrefix(unit, "MB"):
		return val * 1024 * 1024
	case strings.HasPrefix(unit, "KIB") || strings.HasPrefix(unit, "KB"):
		return val * 1024
	default:
		return val
	}
}

// parseETAToSeconds converts a "MM:SS" or "HH:MM:SS" ETA string into seconds.
func parseETAToSeconds(s string) float64 {
	parts := strings.Split(strings.TrimSpace(s), ":")
	switch len(parts) {
	case 2:
		m, _ := strconv.Atoi(parts[0])
		sec, _ := strconv.Atoi(parts[1])
		return float64(m*60 + sec)
	case 3:
		h, _ := strconv.Atoi(parts[0])
		m, _ := strconv.Atoi(parts[1])
		sec, _ := strconv.Atoi(parts[2])
		return float64(h*3600 + m*60 + sec)
	default:
		return 0
	}
}

// processOutputLine updates the YTDLPTaskController's atomic byte/speed/ETA counters from a single stdout line.
func (t *YTDLPTaskController) processOutputLine(line string) {
	if alreadyMatches := ytdlpAlreadyRegex.FindStringSubmatch(line); len(alreadyMatches) > 1 {
		alreadyFile := strings.TrimSpace(alreadyMatches[1])
		if fi, err := os.Stat(alreadyFile); err == nil && fi.Size() > 0 {
			t.prevStreamsTotal.Add(fi.Size())
		}
	}

	if strings.Contains(line, "[download] Destination:") {
		// A new stream format is starting; accumulate any previous stream's total bytes.
		if currTot := t.currentStreamTotal.Load(); currTot > 0 {
			t.prevStreamsTotal.Add(currTot)
			t.currentStreamTotal.Store(0)
			t.currentStreamDL.Store(0)
		}
	}

	percent, total, dl, speed, eta, isMerging, matched := parseYTDLPLine(line)
	if isMerging {
		t.mu.Lock()
		t.State.Status = core.StatusMerging
		t.mu.Unlock()
		t.emitProgress()
		return
	}

	if matched {
		if total > 0 {
			t.currentStreamTotal.Store(total)
		}
		if dl > 0 {
			t.currentStreamDL.Store(dl)
		}

		overallTotal := t.prevStreamsTotal.Load() + t.currentStreamTotal.Load()
		overallDL := t.prevStreamsTotal.Load() + t.currentStreamDL.Load()

		if overallTotal > 0 {
			t.totalBytes.Store(overallTotal)
			t.State.TotalSize = overallTotal
		}
		if overallDL > 0 {
			t.downloaded.Store(overallDL)
		}
		if speed > 0 {
			t.speedVal.Store(int64(speed))
		}
		if eta > 0 {
			t.etaVal.Store(int64(eta))
		}
		if overallTotal > 0 && overallDL > 0 {
			t.percentVal.Store(int64(float64(overallDL) / float64(overallTotal) * 100))
		} else if percent > 0 {
			t.percentVal.Store(int64(percent))
		}
	}
}
