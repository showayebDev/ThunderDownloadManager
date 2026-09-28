// ytdlp_metadata.go handles video URL detection, metadata and format extraction,
// fallback filename generation, and standalone client stream downloads via yt-dlp.
package ytdlp

import (
	"bytes"
	"encoding/json"
	"fmt"
	"log"
	"os"
	"os/exec"
	"strconv"
	"strings"

	"ThunderDM/src-wails3/downloader/core"
	"ThunderDM/src-wails3/downloader/proxy"
	"ThunderDM/src-wails3/downloader/sys"
)

// Format represents a single audio/video stream format returned by yt-dlp.
type Format struct {
	FormatID   string  `json:"format_id"`
	Ext        string  `json:"ext"`
	Resolution string  `json:"resolution"`
	FPS        float64 `json:"fps"`
	VCodec     string  `json:"vcodec"`
	ACodec     string  `json:"acodec"`
	Filesize   int64   `json:"filesize"`
	FormatNote string  `json:"format_note"`
}

// DownloadOptions configures a direct Client.Download invocation.
type DownloadOptions struct {
	URL         string
	OutputFile  string
	Quality     string // e.g. "1080p", "720p", "best", "audio" or "137"
	MergeToMP4  bool
	Cookies     string
	ForceCookie bool
	ExtraArgs   []string
}

// VideoMetadata holds probed metadata and available formats for a video URL.
type VideoMetadata struct {
	ID          string   `json:"id"`
	Title       string   `json:"title"`
	Fulltitle   string   `json:"fulltitle"`
	Description string   `json:"description"`
	Uploader    string   `json:"uploader"`
	Channel     string   `json:"channel"`
	Ext         string   `json:"ext"`
	Duration    float64  `json:"duration"`
	Thumbnail   string   `json:"thumbnail"`
	Formats     []Format `json:"formats"`
}

// IsYTDLPURL checks if a URL belongs to video hosting platforms handled best by yt-dlp.
func IsYTDLPURL(urlStr string) bool {
	return core.IsYTDLPURL(urlStr)
}

// ExtractYTDLPFallbackFilename generates a clean, readable fallback filename from any video URL.
func ExtractYTDLPFallbackFilename(rawURL string) string {
	return core.ExtractYTDLPFallbackFilename(rawURL)
}

// IsCookieBrokenHost checks if passing raw header cookies (--add-header "Cookie: ...") is bypassed for the host in yt-dlp.
func IsCookieBrokenHost(uStr string) bool {
	return core.IsCookieBrokenHost(uStr)
}

// FetchVideoMetadata is a package-level helper that fetches video metadata using the default Client.
func FetchVideoMetadata(urlStr string, cookies ...string) (*VideoMetadata, error) {
	return NewClient().GetVideoMetadata(urlStr, cookies...)
}

// GetVideoMetadata fetches complete video metadata including title and deduplicated formats using yt-dlp JSON output.
func (c *Client) GetVideoMetadata(urlStr string, cookies ...string) (*VideoMetadata, error) {
	exe := GetYTDLPExecutable()
	if exe == "" {
		return nil, fmt.Errorf("yt-dlp is not installed in ThunderDM")
	}
	c.Executable = exe

	cookieVal := ""
	if len(cookies) > 0 && cookies[0] != "" {
		cookieVal = cookies[0]
	}
	forceCookie := len(cookies) > 1 && (cookies[1] == "true" || cookies[1] == "1")

	execWithArgs := func(useCookie bool) (*VideoMetadata, error) {
		args := []string{
			"--no-playlist", "--skip-download", "-J",
			"--socket-timeout", "8", "--extractor-retries", "1",
			"--no-warnings",
		}
		if ffmpegLoc := GetFFmpegLocation(); ffmpegLoc != "" {
			args = append(args, "--ffmpeg-location", ffmpegLoc)
		}
		if useCookie && cookieVal != "" && (forceCookie || !IsCookieBrokenHost(urlStr)) {
			args = append(args, "--add-header", "Cookie: "+cookieVal)
		}
		if proxyStr := proxy.GetProxyManager().GetProxyStringForURL(urlStr); proxyStr != "" {
			args = append(args, "--proxy", proxyStr)
		} else {
			args = append(args, "--proxy", "")
		}
		args = append(args, urlStr)

		cmd := sys.PrepareCmd(exec.Command(c.Executable, args...))
		cmd.Env = buildYTDLPEnv(urlStr)
		var out bytes.Buffer
		var errBuf bytes.Buffer
		cmd.Stdout = &out
		cmd.Stderr = &errBuf

		if err := cmd.Run(); err != nil {
			return nil, fmt.Errorf("failed to fetch metadata: %w, stderr: %s", err, strings.TrimSpace(errBuf.String()))
		}

		var metadata VideoMetadata
		if err := json.Unmarshal(out.Bytes(), &metadata); err != nil {
			return nil, fmt.Errorf("failed to parse metadata JSON: %w", err)
		}

		var formats []Format
		seenRes := make(map[string]bool)

		for _, f := range metadata.Formats {
			if f.VCodec != "none" && f.VCodec != "images" && f.Resolution != "" && f.Resolution != "audio only" {
				if !seenRes[f.Resolution] {
					seenRes[f.Resolution] = true
					formats = append(formats, f)
				}
			}
		}
		metadata.Formats = formats

		return &metadata, nil
	}

	// 1. Try with cookies if provided and safe (or forced)
	if cookieVal != "" && (forceCookie || !IsCookieBrokenHost(urlStr)) {
		meta, err := execWithArgs(true)
		if err == nil && meta != nil {
			return meta, nil
		}
		log.Printf("[YTDLP] Metadata fetch with cookies failed: %v, retrying without cookies...\n", err)
	}

	// 2. Try without cookies
	return execWithArgs(false)
}

// GetFormats fetches video metadata and returns the deduplicated video formats.
func (c *Client) GetFormats(urlStr string, cookies ...string) ([]Format, error) {
	meta, err := c.GetVideoMetadata(urlStr, cookies...)
	if err != nil {
		return nil, err
	}
	return meta.Formats, nil
}

// Download handles downloading video/audio streams and merging into MP4.
func (c *Client) Download(opts DownloadOptions, progressCallback func(line string)) error {
	exe := GetYTDLPExecutable()
	if exe == "" {
		return fmt.Errorf("yt-dlp is not installed in ThunderDM")
	}
	c.Executable = exe

	cfg := core.GetEngineConfig()
	maxRetries := cfg.MaxRetries
	if maxRetries <= 0 {
		maxRetries = 3
	}

	args := []string{
		"--newline", "--no-playlist", "--continue", "--part", "--windows-filenames", "--trim-filenames", "120",
		"--retries", strconv.Itoa(maxRetries), "--fragment-retries", strconv.Itoa(maxRetries),
	}
	if ffmpegLoc := GetFFmpegLocation(); ffmpegLoc != "" {
		args = append(args, "--ffmpeg-location", ffmpegLoc)
	}

	if opts.Cookies != "" && (opts.ForceCookie || !IsCookieBrokenHost(opts.URL)) {
		args = append(args, "--add-header", "Cookie: "+opts.Cookies)
	}

	if opts.MergeToMP4 {
		args = append(args, "--merge-output-format", "mp4")
	}

	if opts.Quality != "" && opts.Quality != "best" {
		qualityArg := opts.Quality
		if !strings.Contains(qualityArg, "+") {
			qualityArg = qualityArg + "+bestaudio/best"
		}
		args = append(args, "-f", qualityArg)
	}

	if opts.OutputFile != "" {
		args = append(args, "-o", opts.OutputFile)
	}

	if len(opts.ExtraArgs) > 0 {
		args = append(args, opts.ExtraArgs...)
	}

	if proxyStr := proxy.GetProxyManager().GetProxyStringForURL(opts.URL); proxyStr != "" {
		args = append(args, "--proxy", proxyStr)
	} else {
		args = append(args, "--proxy", "")
	}

	args = append(args, opts.URL)

	cmd := sys.PrepareCmd(exec.Command(c.Executable, args...))
	cmd.Env = buildYTDLPEnv(opts.URL)

	stdout, err := cmd.StdoutPipe()
	if err != nil {
		return fmt.Errorf("failed to pipe stdout: %w", err)
	}

	cmd.Stderr = os.Stderr

	if err := cmd.Start(); err != nil {
		return fmt.Errorf("failed to start download: %w", err)
	}

	go streamLinesFromReader(stdout, progressCallback)

	return cmd.Wait()
}
