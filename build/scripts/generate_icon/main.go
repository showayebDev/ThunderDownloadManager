package main

import (
	"bytes"
	"encoding/binary"
	"fmt"
	"image"
	"image/color"
	"image/draw"
	"image/png"
	"math"
	"os"
	"path/filepath"

	xdraw "golang.org/x/image/draw"
)

const svgTemplate = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024" width="100%" height="100%">
  <defs>
    <linearGradient id="bg-grad" x1="0%" y1="0%" x2="0%" y2="100%">
      <stop offset="0%" stop-color="#161030" />
      <stop offset="100%" stop-color="#7C20EB" />
    </linearGradient>
    <filter id="shadow" x="-20%" y="-20%" width="140%" height="140%">
      <feDropShadow dx="0" dy="16" stdDeviation="18" flood-color="#080414" flood-opacity="0.75" />
    </filter>
  </defs>
  <!-- Squircle background -->
  <rect x="51.2" y="51.2" width="921.6" height="921.6" rx="225.28" ry="225.28" fill="url(#bg-grad)" />
  <!-- Border stroke -->
  <rect x="51.2" y="51.2" width="921.6" height="921.6" rx="225.28" ry="225.28" fill="none" stroke="#C48CFF" stroke-width="16.384" stroke-opacity="0.85" />
  <!-- Emblem group with shadow -->
  <g filter="url(#shadow)">
    <!-- Pure Solid White Arrow -->
    <polygon points="414.72,233.47 609.28,233.47 609.28,438.27 752.64,438.27 512,730.11 271.36,438.27 414.72,438.27" fill="#FFFFFF" />
    <!-- Electric Cyan Speed Bar -->
    <rect x="312.32" y="781.31" width="399.36" height="46.08" rx="22.53" ry="22.53" fill="#38BDF8" />
    <!-- Dynamic Lightning Cutout -->
    <polygon points="561.15,289.79 442.37,484.35 530.43,484.35 464.90,675.84 581.63,512.00 493.57,512.00" fill="#7C3AED" />
  </g>
</svg>`

// Point represents a 2D coordinate.
type Point struct {
	X, Y float64
}

// Resize rescales an image using Lanczos/CatmullRom resampling.
func resizeImage(src image.Image, width, height int) image.Image {
	dst := image.NewRGBA(image.Rect(0, 0, width, height))
	xdraw.CatmullRom.Scale(dst, dst.Bounds(), src, src.Bounds(), draw.Over, nil)
	return dst
}

// Helper to write PNG files to disk securely.
func savePNG(img image.Image, path string) error {
	if err := os.MkdirAll(filepath.Dir(path), 0755); err != nil {
		return err
	}
	f, err := os.Create(path)
	if err != nil {
		return err
	}
	defer f.Close()
	return png.Encode(f, img)
}

// Saves a multi-resolution Windows ICO file (512, 256, 128, 64).
func saveICOMultiRes(iconImg image.Image, icoPath string) error {
	sizes := []int{512, 256, 128, 64}

	if err := os.MkdirAll(filepath.Dir(icoPath), 0755); err != nil {
		return err
	}

	type pngData struct {
		size int
		data []byte
	}
	var entries []pngData

	for _, s := range sizes {
		resized := resizeImage(iconImg, s, s)
		var buf bytes.Buffer
		if err := png.Encode(&buf, resized); err != nil {
			return err
		}
		entries = append(entries, pngData{size: s, data: buf.Bytes()})
	}

	f, err := os.Create(icoPath)
	if err != nil {
		return err
	}
	defer f.Close()

	count := uint16(len(entries))
	binary.Write(f, binary.LittleEndian, uint16(0))
	binary.Write(f, binary.LittleEndian, uint16(1))
	binary.Write(f, binary.LittleEndian, count)

	offset := uint32(6 + (16 * len(entries)))

	for _, entry := range entries {
		w := byte(0)
		if entry.size < 256 {
			w = byte(entry.size)
		}
		h := byte(0)
		if entry.size < 256 {
			h = byte(entry.size)
		}

		f.Write([]byte{
			w, h,
			0,
			0,
			1, 0,
			32, 0,
		})
		binary.Write(f, binary.LittleEndian, uint32(len(entry.data)))
		binary.Write(f, binary.LittleEndian, offset)

		offset += uint32(len(entry.data))
	}

	for _, entry := range entries {
		f.Write(entry.data)
	}

	fmt.Printf("  [OK] Saved ICO: %s\n", icoPath)
	return nil
}

// Saves an ICNS container housing a 512x512 PNG stream.
func saveICNS512(iconImg image.Image, icnsPath string) error {
	if err := os.MkdirAll(filepath.Dir(icnsPath), 0755); err != nil {
		return err
	}

	img512 := resizeImage(iconImg, 512, 512)
	var pngBuf bytes.Buffer
	if err := png.Encode(&pngBuf, img512); err != nil {
		return err
	}
	pngBytes := pngBuf.Bytes()

	tag := []byte("ic09")
	blockLen := uint32(8 + len(pngBytes))

	block := make([]byte, 8+len(pngBytes))
	copy(block[0:4], tag)
	binary.BigEndian.PutUint32(block[4:8], blockLen)
	copy(block[8:], pngBytes)

	totalLen := uint32(8 + len(block))
	header := make([]byte, 8)
	copy(header[0:4], []byte("icns"))
	binary.BigEndian.PutUint32(header[4:8], totalLen)

	f, err := os.Create(icnsPath)
	if err != nil {
		return err
	}
	defer f.Close()

	if _, err := f.Write(header); err != nil {
		return err
	}
	if _, err := f.Write(block); err != nil {
		return err
	}

	fmt.Printf("  [OK] Saved ICNS: %s\n", icnsPath)
	return nil
}

func saveSVG(outputPath string) error {
	if err := os.MkdirAll(filepath.Dir(outputPath), 0755); err != nil {
		return err
	}
	err := os.WriteFile(outputPath, []byte(svgTemplate), 0644)
	if err == nil {
		fmt.Printf("  [OK] Saved SVG: %s\n", outputPath)
	}
	return err
}

func isInsidePolygon(pt Point, poly []Point) bool {
	inside := false
	j := len(poly) - 1
	for i := 0; i < len(poly); i++ {
		if (poly[i].Y > pt.Y) != (poly[j].Y > pt.Y) &&
			(pt.X < (poly[j].X-poly[i].X)*(pt.Y-poly[i].Y)/(poly[j].Y-poly[i].Y)+poly[i].X) {
			inside = !inside
		}
		j = i
	}
	return inside
}

func distanceToRoundedRect(x, y, minX, minY, maxX, maxY, radius float64) float64 {
	cx := math.Max(minX+radius, math.Min(x, maxX-radius))
	cy := math.Max(minY+radius, math.Min(y, maxY-radius))

	dx := x - cx
	dy := y - cy

	if x >= minX+radius && x <= maxX-radius {
		dx = 0
	}
	if y >= minY+radius && y <= maxY-radius {
		dy = 0
	}

	return math.Hypot(dx, dy)
}

func createSuperIcon(size int) image.Image {
	img := image.NewRGBA(image.Rect(0, 0, size, size))
	fSize := float64(size)

	padding := fSize * 0.05
	radius := fSize * 0.22
	strokeWidth := fSize * 0.016

	cx, cy := fSize/2.0, fSize/2.0-fSize*0.012

	arrowPts := []Point{
		{cx - fSize*0.095, cy - fSize*0.26},
		{cx + fSize*0.095, cy - fSize*0.26},
		{cx + fSize*0.095, cy - fSize*0.06},
		{cx + fSize*0.235, cy - fSize*0.06},
		{cx, cy + fSize*0.225},
		{cx - fSize*0.235, cy - fSize*0.06},
		{cx - fSize*0.095, cy - fSize*0.06},
	}

	lightningPts := []Point{
		{cx + fSize*0.048, cy - fSize*0.205},
		{cx - fSize*0.068, cy - fSize*0.015},
		{cx + fSize*0.018, cy - fSize*0.015},
		{cx - fSize*0.046, cy + fSize*0.172},
		{cx + fSize*0.068, cy + fSize*0.012},
		{cx - fSize*0.018, cy + fSize*0.012},
	}

	barY := cy + fSize*0.275
	barMinX, barMaxX := cx-fSize*0.195, cx+fSize*0.195
	barMinY, barMaxY := barY, barY+fSize*0.045
	barRadius := fSize * 0.022

	minX, minY := padding, padding
	maxX, maxY := fSize-padding, fSize-padding

	for y := 0; y < size; y++ {
		fy := float64(y) + 0.5
		rRatio := fy / fSize

		bgR := uint8(22*(1-rRatio) + 124*rRatio)
		bgG := uint8(14*(1-rRatio) + 32*rRatio)
		bgB := uint8(64*(1-rRatio) + 225*rRatio)

		for x := 0; x < size; x++ {
			fx := float64(x) + 0.5

			sqDist := distanceToRoundedRect(fx, fy, minX, minY, maxX, maxY, radius)
			if sqDist > radius+0.5 {
				continue
			}

			squircleAlpha := 1.0
			if sqDist > radius-0.5 {
				squircleAlpha = math.Max(0, math.Min(1, radius+0.5-sqDist))
			}

			pr, pg, pb, pa := bgR, bgG, bgB, uint8(255)

			strokeDist := math.Abs(sqDist - radius)
			if strokeDist <= strokeWidth/2.0+0.5 {
				sAlpha := 1.0
				if strokeDist > strokeWidth/2.0-0.5 {
					sAlpha = math.Max(0, math.Min(1, strokeWidth/2.0+0.5-strokeDist))
				}
				sAlpha *= 0.85

				br, bg, bb := uint8(196), uint8(140), uint8(255)
				pr = uint8(float64(br)*sAlpha + float64(pr)*(1-sAlpha))
				pg = uint8(float64(bg)*sAlpha + float64(pg)*(1-sAlpha))
				pb = uint8(float64(bb)*sAlpha + float64(pb)*(1-sAlpha))
			}

			pt := Point{X: fx, Y: fy}

			inArrow := isInsidePolygon(pt, arrowPts)

			bDist := distanceToRoundedRect(fx, fy, barMinX, barMinY, barMaxX, barMaxY, barRadius)
			inBar := bDist <= barRadius

			if inArrow {
				pr, pg, pb = 255, 255, 255
				if isInsidePolygon(pt, lightningPts) {
					pr, pg, pb = 124, 58, 237
				}
			} else if inBar {
				pr, pg, pb = 56, 189, 248
			}

			finalA := uint8(float64(pa) * squircleAlpha)
			img.SetRGBA(x, y, color.RGBA{R: pr, G: pg, B: pb, A: finalA})
		}
	}

	return img
}

func findRootDir() string {
	dir, err := os.Getwd()
	if err != nil {
		dir = "."
	}
	for i := 0; i < 5; i++ {
		if _, err := os.Stat(filepath.Join(dir, "go.mod")); err == nil {
			return dir
		}
		parent := filepath.Dir(dir)
		if parent == dir {
			break
		}
		dir = parent
	}
	abs, _ := filepath.Abs(".")
	return abs
}

func main() {
	rootDir := findRootDir()

	fmt.Println("[ThunderDM] Rendering 4096x4096 Super-Sampled Master Icon with New Lightning Icon...")
	masterIcon := createSuperIcon(4096)

	// 1. Master appicon.png in build/
	appiconPath := filepath.Join(rootDir, "build", "appicon.png")
	img1024 := resizeImage(masterIcon, 1024, 1024)
	if err := savePNG(img1024, appiconPath); err == nil {
		fmt.Printf("  [OK] Saved Master PNG: %s (1024x1024)\n", appiconPath)
	}

	// 2. Windows & Multi-Platform ICO & ICNS
	saveICOMultiRes(masterIcon, filepath.Join(rootDir, "build", "windows", "icon.ico"))
	saveICOMultiRes(masterIcon, filepath.Join(rootDir, "src-wails3", "icons", "icon.ico"))
	saveICNS512(masterIcon, filepath.Join(rootDir, "src-wails3", "icons", "icon.icns"))
	saveICNS512(masterIcon, filepath.Join(rootDir, "build", "darwin", "icons.icns"))

	// 3. Icons for src-wails3/icons/ (Strictly >= 64px: 64, 128, 256, 512, 1024)
	wails3IconsDir := filepath.Join(rootDir, "src-wails3", "icons")
	saveSVG(filepath.Join(wails3IconsDir, "icon.svg"))

	for _, oldSize := range []int{16, 32, 48} {
		oldFile := filepath.Join(wails3IconsDir, fmt.Sprintf("icon_%dx%d.png", oldSize, oldSize))
		os.Remove(oldFile)
	}

	master512 := resizeImage(masterIcon, 512, 512)
	savePNG(master512, filepath.Join(wails3IconsDir, "icon.png"))

	sizes := []int{64, 128, 256, 512, 1024}
	for _, s := range sizes {
		res := resizeImage(masterIcon, s, s)
		outF := filepath.Join(wails3IconsDir, fmt.Sprintf("icon_%dx%d.png", s, s))
		if err := savePNG(res, outF); err == nil {
			fmt.Printf("  [OK] Saved src-wails3 icon: %s (%dx%d)\n", outF, s, s)
		}
	}

	// 4. Browser Extension Icons (extension/src/icons/)
	extIconsDir := filepath.Join(rootDir, "extension", "src", "icons")
	saveSVG(filepath.Join(extIconsDir, "icon.svg"))
	for _, s := range []int{128, 48, 32, 16} {
		extIcon := resizeImage(masterIcon, s, s)
		outF := filepath.Join(extIconsDir, fmt.Sprintf("icon%d.png", s))
		if err := savePNG(extIcon, outF); err == nil {
			fmt.Printf("  [OK] Saved Extension Icon: %s (%dx%d)\n", outF, s, s)
		}
	}

	// 5. Frontend Public Folder: Strictly only icon.svg
	frontendPublic := filepath.Join(rootDir, "frontend", "public")
	os.Remove(filepath.Join(frontendPublic, "favicon.png"))
	os.Remove(filepath.Join(frontendPublic, "favicon.svg"))
	os.Remove(filepath.Join(frontendPublic, "icon.png"))
	saveSVG(filepath.Join(frontendPublic, "icon.svg"))

	fmt.Println("\n[ThunderDM] All icons generated across all folders successfully!")
}
