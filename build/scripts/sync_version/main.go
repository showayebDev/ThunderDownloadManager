package main

import (
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"strings"
)

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

	configPath := filepath.Join(rootDir, "build", "config.yml")
	configData, err := os.ReadFile(configPath)
	if err != nil {
		fmt.Printf("Error reading %s: %v\n", configPath, err)
		return
	}

	configContent := string(configData)

	// If a new version is provided as argument, update config.yml
	if len(os.Args) > 1 && strings.TrimSpace(os.Args[1]) != "" {
		newVer := strings.TrimSpace(os.Args[1])
		// Replace version inside info: block
		verRegex := regexp.MustCompile(`(?m)(info:[\s\S]*?^\s+version:\s*)["'].*?["']`)
		if verRegex.MatchString(configContent) {
			configContent = verRegex.ReplaceAllString(configContent, fmt.Sprintf(`${1}"%s"`, newVer))
			_ = os.WriteFile(configPath, []byte(configContent), 0644)
			fmt.Printf("Updated build/config.yml version to: %s\n", newVer)
		}
	}

	// Extract values from config.yml info: block
	version := extractInfoField(configContent, `version`)
	productName := extractInfoField(configContent, `productName`)
	companyName := extractInfoField(configContent, `companyName`)
	productIdentifier := extractInfoField(configContent, `productIdentifier`)
	copyright := extractInfoField(configContent, `copyright`)

	if version == "" {
		version = "1.0.0"
	}
	if productName == "" {
		productName = "Thunder Download Manager"
	}
	if productIdentifier == "" {
		productIdentifier = "com.thunderdm.thunderdm"
	}
	if copyright == "" {
		copyright = fmt.Sprintf("© 2026 %s", productName)
	}

	// Clean numeric version for Windows fixed PE metadata and browser manifests (e.g. 1.0.0.0 from 1.0.0-beta.1)
	cleanNumericVer := strings.Split(version, "-")[0]
	cleanNumericVer = strings.Split(cleanNumericVer, "+")[0]
	reDigits := regexp.MustCompile(`[^0-9.]`)
	cleanNumericVer = reDigits.ReplaceAllString(cleanNumericVer, "")
	if cleanNumericVer == "" {
		cleanNumericVer = "1.0.0"
	}
	vParts := strings.Split(cleanNumericVer, ".")
	for len(vParts) < 4 {
		vParts = append(vParts, "0")
	}
	v4 := strings.Join(vParts[:4], ".")

	// 1. Sync build/windows/info.json
	infoJsonPath := filepath.Join(rootDir, "build", "windows", "info.json")
	infoJsonContent := fmt.Sprintf(`{
	"fixed": {
		"file_version": "%s",
		"product_version": "%s"
	},
	"info": {
		"0409": {
			"Comments": "%s",
			"CompanyName": "%s",
			"FileDescription": "%s",
			"FileVersion": "%s",
			"InternalName": "%s",
			"LegalCopyright": "%s",
			"LegalTrademarks": "%s",
			"OriginalFilename": "ThunderDownloadManager.exe",
			"ProductName": "%s",
			"ProductVersion": "%s"
		},
		"0000": {
			"Comments": "%s",
			"CompanyName": "%s",
			"FileDescription": "%s",
			"FileVersion": "%s",
			"InternalName": "%s",
			"LegalCopyright": "%s",
			"LegalTrademarks": "%s",
			"OriginalFilename": "ThunderDownloadManager.exe",
			"ProductName": "%s",
			"ProductVersion": "%s"
		}
	}
}
`, v4, v4, productName, companyName, productName, v4, productName, copyright, productName, productName, version, productName, companyName, productName, v4, productName, copyright, productName, productName, version)
	_ = os.WriteFile(infoJsonPath, []byte(infoJsonContent), 0644)

	// 2. Sync build/windows/nsis/project.nsi
	projectNsiPath := filepath.Join(rootDir, "build", "windows", "nsis", "project.nsi")
	if nsiData, err := os.ReadFile(projectNsiPath); err == nil {
		nsiStr := string(nsiData)
		nsiStr = regexp.MustCompile(`(?m)^!define INFO_PRODUCTVERSION\s+.*`).ReplaceAllString(nsiStr, fmt.Sprintf(`!define INFO_PRODUCTVERSION "%s"`, version))
		if strings.Contains(nsiStr, "!define INFO_FILEVERSION") {
			nsiStr = regexp.MustCompile(`(?m)^!define INFO_FILEVERSION\s+.*`).ReplaceAllString(nsiStr, fmt.Sprintf(`!define INFO_FILEVERSION    "%s"`, v4))
		} else {
			nsiStr = regexp.MustCompile(`(?m)^!define INFO_PRODUCTVERSION\s+.*`).ReplaceAllString(nsiStr, fmt.Sprintf("!define INFO_PRODUCTVERSION \"%s\"\n!define INFO_FILEVERSION    \"%s\"", version, v4))
		}
		nsiStr = regexp.MustCompile(`(?m)^!define INFO_PRODUCTNAME\s+.*`).ReplaceAllString(nsiStr, fmt.Sprintf(`!define INFO_PRODUCTNAME    "%s"`, productName))
		nsiStr = regexp.MustCompile(`(?m)^!define INFO_COMPANYNAME\s+.*`).ReplaceAllString(nsiStr, fmt.Sprintf(`!define INFO_COMPANYNAME    "%s"`, companyName))
		nsiStr = regexp.MustCompile(`(?m)^!define INFO_COPYRIGHT\s+.*`).ReplaceAllString(nsiStr, fmt.Sprintf(`!define INFO_COPYRIGHT      "%s"`, copyright))
		_ = os.WriteFile(projectNsiPath, []byte(nsiStr), 0644)
	}

	// 3. Sync build/windows/nsis/wails_tools.nsh
	wailsToolsPath := filepath.Join(rootDir, "build", "windows", "nsis", "wails_tools.nsh")
	wailsToolsContent := fmt.Sprintf(`# DO NOT EDIT - Generated automatically by sync_version

!include "x64.nsh"
!include "WinVer.nsh"
!include "FileFunc.nsh"

!ifndef INFO_PROJECTNAME
    !define INFO_PROJECTNAME "ThunderDM"
!endif
!ifndef INFO_COMPANYNAME
    !define INFO_COMPANYNAME "%s"
!endif
!ifndef INFO_PRODUCTNAME
    !define INFO_PRODUCTNAME "%s"
!endif
!ifndef INFO_PRODUCTVERSION
    !define INFO_PRODUCTVERSION "%s"
!endif
!ifndef INFO_FILEVERSION
    !define INFO_FILEVERSION "%s"
!endif
!ifndef INFO_COPYRIGHT
    !define INFO_COPYRIGHT "%s"
!endif
!ifndef PRODUCT_EXECUTABLE
    !define PRODUCT_EXECUTABLE "ThunderDownloadManager.exe"
!endif
!ifndef UNINST_KEY_NAME
    !define UNINST_KEY_NAME "ThunderDownloadManager"
!endif
!define UNINST_KEY "Software\Microsoft\Windows\CurrentVersion\Uninstall\${UNINST_KEY_NAME}"

!ifndef WAILS_INSTALL_SCOPE
    !define WAILS_INSTALL_SCOPE "machine"
!endif

!ifndef REQUEST_EXECUTION_LEVEL
    !if "${WAILS_INSTALL_SCOPE}" == "user"
        !define REQUEST_EXECUTION_LEVEL "user"
    !else
        !define REQUEST_EXECUTION_LEVEL "admin"
    !endif
!endif

RequestExecutionLevel "${REQUEST_EXECUTION_LEVEL}"

!ifdef ARG_WAILS_AMD64_BINARY
    !define SUPPORTS_AMD64
!endif

!ifdef ARG_WAILS_ARM64_BINARY
    !define SUPPORTS_ARM64
!endif

!ifdef SUPPORTS_AMD64
    !ifdef SUPPORTS_ARM64
        !define ARCH "amd64_arm64"
    !else
        !define ARCH "amd64"
    !endif
!else
    !ifdef SUPPORTS_ARM64
        !define ARCH "arm64"
    !else
        !error "Wails: Undefined ARCH, please provide at least one of ARG_WAILS_AMD64_BINARY or ARG_WAILS_ARM64_BINARY"
    !endif
!endif

!macro wails.checkArchitecture
    !ifndef WAILS_WIN10_REQUIRED
        !define WAILS_WIN10_REQUIRED "This product is only supported on Windows 10 (Server 2016) and later."
    !endif

    !ifndef WAILS_ARCHITECTURE_NOT_SUPPORTED
        !define WAILS_ARCHITECTURE_NOT_SUPPORTED "This product can't be installed on the current Windows architecture. Supports: ${ARCH}"
    !endif

    ${If} ${AtLeastWin10}
        !ifdef SUPPORTS_AMD64
            ${if} ${IsNativeAMD64}
                Goto ok
            ${EndIf}
        !endif

        !ifdef SUPPORTS_ARM64
            ${if} ${IsNativeARM64}
                Goto ok
            ${EndIf}
        !endif

        IfSilent silentArch notSilentArch
        silentArch:
            SetErrorLevel 65
            Abort
        notSilentArch:
            MessageBox MB_OK "${WAILS_ARCHITECTURE_NOT_SUPPORTED}"
            Quit
    ${else}
        IfSilent silentWin notSilentWin
        silentWin:
            SetErrorLevel 64
            Abort
        notSilentWin:
            MessageBox MB_OK "${WAILS_WIN10_REQUIRED}"
            Quit
    ${EndIf}

    ok:
!macroend

!macro wails.files
    !ifdef SUPPORTS_AMD64
        ${if} ${IsNativeAMD64}
            File "/oname=${PRODUCT_EXECUTABLE}" "${ARG_WAILS_AMD64_BINARY}"
        ${EndIf}
    !endif

    !ifdef SUPPORTS_ARM64
        ${if} ${IsNativeARM64}
            File "/oname=${PRODUCT_EXECUTABLE}" "${ARG_WAILS_ARM64_BINARY}"
        ${EndIf}
    !endif
!macroend

!macro wails.writeUninstaller
    WriteUninstaller "$INSTDIR\uninstall.exe"

    SetRegView 64
    !if "${WAILS_INSTALL_SCOPE}" == "user"
        !if "${INFO_COMPANYNAME}" != ""
            WriteRegStr HKCU "${UNINST_KEY}" "Publisher" "${INFO_COMPANYNAME}"
        !endif
        WriteRegStr HKCU "${UNINST_KEY}" "DisplayName" "${INFO_PRODUCTNAME}"
        WriteRegStr HKCU "${UNINST_KEY}" "DisplayVersion" "${INFO_PRODUCTVERSION}"
        WriteRegStr HKCU "${UNINST_KEY}" "DisplayIcon" "$INSTDIR\${PRODUCT_EXECUTABLE}"
        WriteRegStr HKCU "${UNINST_KEY}" "UninstallString" "$\"$INSTDIR\uninstall.exe$\""
        WriteRegStr HKCU "${UNINST_KEY}" "QuietUninstallString" "$\"$INSTDIR\uninstall.exe$\" /S"

        ${GetSize} "$INSTDIR" "/S=0K" $0 $1 $2
        IntFmt $0 "0x%%08X" $0
        WriteRegDWORD HKCU "${UNINST_KEY}" "EstimatedSize" "$0"
    !else
        !if "${INFO_COMPANYNAME}" != ""
            WriteRegStr HKLM "${UNINST_KEY}" "Publisher" "${INFO_COMPANYNAME}"
        !endif
        WriteRegStr HKLM "${UNINST_KEY}" "DisplayName" "${INFO_PRODUCTNAME}"
        WriteRegStr HKLM "${UNINST_KEY}" "DisplayVersion" "${INFO_PRODUCTVERSION}"
        WriteRegStr HKLM "${UNINST_KEY}" "DisplayIcon" "$INSTDIR\${PRODUCT_EXECUTABLE}"
        WriteRegStr HKLM "${UNINST_KEY}" "UninstallString" "$\"$INSTDIR\uninstall.exe$\""
        WriteRegStr HKLM "${UNINST_KEY}" "QuietUninstallString" "$\"$INSTDIR\uninstall.exe$\" /S"

        ${GetSize} "$INSTDIR" "/S=0K" $0 $1 $2
        IntFmt $0 "0x%%08X" $0
        WriteRegDWORD HKLM "${UNINST_KEY}" "EstimatedSize" "$0"
    !endif
!macroend

!macro wails.deleteUninstaller
    Delete "$INSTDIR\uninstall.exe"

    SetRegView 64
    !if "${WAILS_INSTALL_SCOPE}" == "user"
        DeleteRegKey HKCU "${UNINST_KEY}"
    !else
        DeleteRegKey HKLM "${UNINST_KEY}"
    !endif
!macroend

!macro wails.setShellContext
    ${If} ${REQUEST_EXECUTION_LEVEL} == "admin"
        SetShellVarContext all
    ${else}
        SetShellVarContext current
    ${EndIf}
!macroend

!macro wails.webview2runtime
    !ifndef WAILS_INSTALL_WEBVIEW_DETAILPRINT
        !define WAILS_INSTALL_WEBVIEW_DETAILPRINT "Installing: WebView2 Runtime"
    !endif

    SetRegView 64
	ReadRegStr $0 HKLM "SOFTWARE\WOW6432Node\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}" "pv"
    ${If} $0 != ""
        Goto ok
    ${EndIf}

    ${If} ${REQUEST_EXECUTION_LEVEL} == "user"
	    ReadRegStr $0 HKCU "Software\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}" "pv"
        ${If} $0 != ""
            Goto ok
        ${EndIf}
     ${EndIf}
    
	SetDetailsPrint both
    DetailPrint "${WAILS_INSTALL_WEBVIEW_DETAILPRINT}"
    SetDetailsPrint listonly
    
    InitPluginsDir
    CreateDirectory "$pluginsdir\webview2bootstrapper"
    SetOutPath "$pluginsdir\webview2bootstrapper"
    File "MicrosoftEdgeWebview2Setup.exe"
    ExecWait '"$pluginsdir\webview2bootstrapper\MicrosoftEdgeWebview2Setup.exe" /silent /install'
    
    SetDetailsPrint both
    ok:
!macroend

!macro wails.associateFiles
!macroend

!macro wails.unassociateFiles
!macroend

!macro wails.associateCustomProtocols
!macroend

!macro wails.unassociateCustomProtocols
!macroend
`, companyName, productName, version, v4, copyright)
	_ = os.WriteFile(wailsToolsPath, []byte(wailsToolsContent), 0644)

	// 4. Sync build/windows/msix/app_manifest.xml
	appManifestPath := filepath.Join(rootDir, "build", "windows", "msix", "app_manifest.xml")
	if amData, err := os.ReadFile(appManifestPath); err == nil {
		amStr := string(amData)
		amStr = regexp.MustCompile(`Version="[^"]+"`).ReplaceAllString(amStr, fmt.Sprintf(`Version="%s"`, v4))
		amStr = regexp.MustCompile(`Publisher="CN=[^"]+"`).ReplaceAllString(amStr, fmt.Sprintf(`Publisher="CN=%s"`, productName))
		amStr = regexp.MustCompile(`<PublisherDisplayName>[^<]+</PublisherDisplayName>`).ReplaceAllString(amStr, fmt.Sprintf(`<PublisherDisplayName>%s</PublisherDisplayName>`, productName))
		amStr = regexp.MustCompile(`(?m)^\s*Name="[^"]+"`).ReplaceAllString(amStr, fmt.Sprintf(`    Name="%s"`, productIdentifier))
		amStr = regexp.MustCompile(`<Application Id="[^"]+"`).ReplaceAllString(amStr, fmt.Sprintf(`<Application Id="%s"`, productIdentifier))
		_ = os.WriteFile(appManifestPath, []byte(amStr), 0644)
	}

	// 5. Sync build/windows/msix/template.xml
	templatePath := filepath.Join(rootDir, "build", "windows", "msix", "template.xml")
	if tmData, err := os.ReadFile(templatePath); err == nil {
		tmStr := string(tmData)
		tmStr = regexp.MustCompile(`Version="[^"]+"`).ReplaceAllString(tmStr, fmt.Sprintf(`Version="%s"`, v4))
		tmStr = regexp.MustCompile(`PublisherName="CN=[^"]+"`).ReplaceAllString(tmStr, fmt.Sprintf(`PublisherName="CN=%s"`, productName))
		tmStr = regexp.MustCompile(`PublisherDisplayName="[^"]+"`).ReplaceAllString(tmStr, fmt.Sprintf(`PublisherDisplayName="%s"`, productName))
		tmStr = regexp.MustCompile(`<PublisherDisplayName>[^<]+</PublisherDisplayName>`).ReplaceAllString(tmStr, fmt.Sprintf(`<PublisherDisplayName>%s</PublisherDisplayName>`, productName))
		tmStr = regexp.MustCompile(`(?m)InstallLocation="[^"]+"`).ReplaceAllString(tmStr, fmt.Sprintf("InstallLocation=\"C:\\Program Files\\%s\"", productName))
		tmStr = regexp.MustCompile(`Id="[^"]+"`).ReplaceAllString(tmStr, fmt.Sprintf(`Id="%s"`, productIdentifier))
		_ = os.WriteFile(templatePath, []byte(tmStr), 0644)
	}

	// 5b. Sync build/windows/wails.exe.manifest
	manifestPath := filepath.Join(rootDir, "build", "windows", "wails.exe.manifest")
	if mfData, err := os.ReadFile(manifestPath); err == nil {
		mfStr := string(mfData)
		mfStr = regexp.MustCompile(`name="[^"]+"`).ReplaceAllString(mfStr, fmt.Sprintf(`name="%s"`, productIdentifier))
		_ = os.WriteFile(manifestPath, []byte(mfStr), 0644)
	}

	// 6. Sync build/darwin/Info.plist & Info.dev.plist
	for _, plistName := range []string{"Info.plist", "Info.dev.plist"} {
		plistPath := filepath.Join(rootDir, "build", "darwin", plistName)
		if pData, err := os.ReadFile(plistPath); err == nil {
			pStr := string(pData)
			pStr = replacePlistKey(pStr, "CFBundleVersion", version)
			pStr = replacePlistKey(pStr, "CFBundleShortVersionString", version)
			pStr = replacePlistKey(pStr, "CFBundleName", productName)
			pStr = replacePlistKey(pStr, "CFBundleIdentifier", productIdentifier)
			pStr = replacePlistKey(pStr, "NSHumanReadableCopyright", copyright)
			_ = os.WriteFile(plistPath, []byte(pStr), 0644)
		}
	}

	// 6b. Sync build/ios/Info.plist & Info.dev.plist
	for _, plistName := range []string{"Info.plist", "Info.dev.plist"} {
		plistPath := filepath.Join(rootDir, "build", "ios", plistName)
		if pData, err := os.ReadFile(plistPath); err == nil {
			pStr := string(pData)
			pStr = replacePlistKey(pStr, "CFBundleVersion", version)
			pStr = replacePlistKey(pStr, "CFBundleShortVersionString", version)
			pStr = replacePlistKey(pStr, "CFBundleName", productName)
			idVal := productIdentifier
			if plistName == "Info.dev.plist" {
				idVal += ".dev"
			}
			pStr = replacePlistKey(pStr, "CFBundleIdentifier", idVal)
			pStr = replacePlistKey(pStr, "NSHumanReadableCopyright", copyright)
			_ = os.WriteFile(plistPath, []byte(pStr), 0644)
		}
	}

	// 7. Sync build/linux/desktop & nfpm.yaml
	linuxDesktopPath := filepath.Join(rootDir, "build", "linux", "desktop")
	if ldData, err := os.ReadFile(linuxDesktopPath); err == nil {
		ldStr := string(ldData)
		ldStr = regexp.MustCompile(`(?m)^Name=.*`).ReplaceAllString(ldStr, fmt.Sprintf(`Name=%s`, productName))
		_ = os.WriteFile(linuxDesktopPath, []byte(ldStr), 0644)
	}
	nfpmPath := filepath.Join(rootDir, "build", "linux", "nfpm", "nfpm.yaml")
	if nfData, err := os.ReadFile(nfpmPath); err == nil {
		nfStr := string(nfData)
		nfStr = regexp.MustCompile(`(?m)^version:\s*["'][^"']+["']`).ReplaceAllString(nfStr, fmt.Sprintf(`version: "%s"`, version))
		nfStr = regexp.MustCompile(`(?m)^vendor:\s*["'][^"']+["']`).ReplaceAllString(nfStr, fmt.Sprintf(`vendor: "%s"`, productName))
		_ = os.WriteFile(nfpmPath, []byte(nfStr), 0644)
	}

	// 8. Sync extension/src/manifest.base.json
	extManifestBasePath := filepath.Join(rootDir, "extension", "src", "manifest.base.json")
	if embData, err := os.ReadFile(extManifestBasePath); err == nil {
		embStr := string(embData)
		embStr = regexp.MustCompile(`"version":\s*"[^"]+"`).ReplaceAllString(embStr, fmt.Sprintf(`"version": "%s"`, cleanNumericVer))
		_ = os.WriteFile(extManifestBasePath, []byte(embStr), 0644)
	}

	// 9. Sync extension popup.html (version tag)
	extPopupPath := filepath.Join(rootDir, "extension", "src", "popup.html")
	if epData, err := os.ReadFile(extPopupPath); err == nil {
		epStr := string(epData)
		epStr = regexp.MustCompile(`<span class="version-tag">[^<]*</span>`).ReplaceAllString(epStr, fmt.Sprintf(`<span class="version-tag">v%s</span>`, version))
		_ = os.WriteFile(extPopupPath, []byte(epStr), 0644)
	}

	// 10. Sync dist extension manifests & popups if dist exists
	for _, browserTarget := range []string{"chrome", "firefox", "edge"} {
		mPath := filepath.Join(rootDir, "extension", "dist", browserTarget, "manifest.json")
		if mData, err := os.ReadFile(mPath); err == nil {
			mStr := string(mData)
			mStr = regexp.MustCompile(`"version":\s*"[^"]+"`).ReplaceAllString(mStr, fmt.Sprintf(`"version": "%s"`, cleanNumericVer))
			_ = os.WriteFile(mPath, []byte(mStr), 0644)
		}
		pPath := filepath.Join(rootDir, "extension", "dist", browserTarget, "popup.html")
		if pData, err := os.ReadFile(pPath); err == nil {
			pStr := string(pData)
			pStr = regexp.MustCompile(`<span class="version-tag">[^<]*</span>`).ReplaceAllString(pStr, fmt.Sprintf(`<span class="version-tag">v%s</span>`, version))
			_ = os.WriteFile(pPath, []byte(pStr), 0644)
		}
	}

	// 11. Sync src-wails3/commands/version.go
	versionGoPath := filepath.Join(rootDir, "src-wails3", "commands", "version.go")
	versionGoContent := fmt.Sprintf(`package commands

// Code generated by build/scripts/sync_version. DO NOT EDIT.
var AppVersion = "%s"
`, version)
	_ = os.WriteFile(versionGoPath, []byte(versionGoContent), 0644)

	// 12. Sync src-wails3/server/version.go
	serverVersionGoPath := filepath.Join(rootDir, "src-wails3", "server", "version.go")
	serverVersionGoContent := fmt.Sprintf(`package server

// Code generated by build/scripts/sync_version. DO NOT EDIT.
var AppVersion = "%s"
`, version)
	_ = os.WriteFile(serverVersionGoPath, []byte(serverVersionGoContent), 0644)

	fmt.Printf("✅ App & Extension version synchronized across Windows, macOS, Linux, and Browser Extensions to: %s (v4: %s)\n", version, v4)
}

func extractInfoField(content, fieldName string) string {
	infoIdx := strings.Index(content, "info:")
	if infoIdx == -1 {
		return ""
	}
	infoBlock := content[infoIdx:]
	re := regexp.MustCompile(fmt.Sprintf(`(?m)^\s+%s:\s*["']?([^"'\r\n#]+)["']?`, fieldName))
	matches := re.FindStringSubmatch(infoBlock)
	if len(matches) > 1 {
		return strings.TrimSpace(matches[1])
	}
	return ""
}

func replacePlistKey(plistContent, key, value string) string {
	re := regexp.MustCompile(fmt.Sprintf(`(<key>%s</key>\s*<string>)[^<]*(</string>)`, regexp.QuoteMeta(key)))
	return re.ReplaceAllString(plistContent, fmt.Sprintf("${1}%s${2}", value))
}
