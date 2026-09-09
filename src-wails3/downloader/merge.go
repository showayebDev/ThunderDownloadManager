package downloader

import (
	"context"
	"fmt"
	"io"
	"os"
	"path/filepath"
)

// MergeChunks sequentially appends part files into the final destination file.
func MergeChunks(ctx context.Context, cacheDir, destPath string, chunks []*ChunkState, progressCh chan<- int64) error {
	defer close(progressCh)

	// Ensure the destination directory exists
	dir := NormalizeSavePath(filepath.Dir(destPath))
	if err := os.MkdirAll(dir, 0755); err != nil {
		return fmt.Errorf("failed to create destination directory: %w", err)
	}
	destPath = filepath.Join(dir, filepath.Base(destPath))

	out, err := os.OpenFile(destPath, os.O_CREATE|os.O_WRONLY|os.O_TRUNC, 0644)
	if err != nil {
		return err
	}
	defer out.Close()

	// 1MB buffer for streaming I/O
	buf := make([]byte, 1024*1024)

	// Since chunks can be split, we must merge them in order of their StartByte.
	// Sort a copy of chunks by StartByte just to be safe.
	sortedChunks := make([]*ChunkState, len(chunks))
	copy(sortedChunks, chunks)
	for i := 0; i < len(sortedChunks); i++ {
		for j := i + 1; j < len(sortedChunks); j++ {
			if sortedChunks[i].StartByte > sortedChunks[j].StartByte {
				sortedChunks[i], sortedChunks[j] = sortedChunks[j], sortedChunks[i]
			}
		}
	}

	for _, chunk := range sortedChunks {
		partPath := filepath.Join(cacheDir, fmt.Sprintf("chunk_%d.part", chunk.ID))
		in, err := os.Open(partPath)
		if err != nil {
			return fmt.Errorf("failed to open part file: %w", err)
		}

		for {
			select {
			case <-ctx.Done():
				in.Close()
				out.Close()
				os.Remove(destPath) // Cleanup incomplete merge file
				return ctx.Err()
			default:
			}

			n, readErr := in.Read(buf)
			if n > 0 {
				_, writeErr := out.Write(buf[:n])
				if writeErr != nil {
					in.Close()
					return fmt.Errorf("failed to write to output file: %w", writeErr)
				}
				progressCh <- int64(n)
			}

			if readErr != nil {
				if readErr == io.EOF {
					break
				}
				in.Close()
				return fmt.Errorf("error reading part file: %w", readErr)
			}
		}
		in.Close()
	}

	return nil
}
