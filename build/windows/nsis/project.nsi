Unicode true

####
## The following information is taken from the wails_tools.nsh file, but they can be overwritten here.
####
!define INFO_PROJECTNAME    "ThunderDM"
!define INFO_COMPANYNAME    ""
!define INFO_PRODUCTNAME    "Thunder Download Manager"
!define INFO_PRODUCTVERSION "1.0.0"
!define INFO_FILEVERSION    "1.0.0.0"
!define INFO_COPYRIGHT      "© 2026 Thunder Download Manager"
###
!define PRODUCT_EXECUTABLE  "ThunderDownloadManager.exe"
!define UNINST_KEY_NAME     "ThunderDownloadManager"
####
## Include the wails tools
####
!include "wails_tools.nsh"

# The version information for this two must consist of 4 parts
VIProductVersion "${INFO_FILEVERSION}"
VIFileVersion    "${INFO_FILEVERSION}"

VIAddVersionKey "CompanyName"     "${INFO_COMPANYNAME}"
VIAddVersionKey "FileDescription" "${INFO_PRODUCTNAME} Installer"
VIAddVersionKey "ProductVersion"  "${INFO_PRODUCTVERSION}"
VIAddVersionKey "FileVersion"     "${INFO_PRODUCTVERSION}"
VIAddVersionKey "LegalCopyright"  "${INFO_COPYRIGHT}"
VIAddVersionKey "ProductName"     "${INFO_PRODUCTNAME}"

# Enable HiDPI support. https://nsis.sourceforge.io/Reference/ManifestDPIAware
ManifestDPIAware true

!include "MUI.nsh"

!define MUI_ICON "..\icon.ico"
!define MUI_UNICON "..\icon.ico"
!define MUI_FINISHPAGE_NOAUTOCLOSE
!define MUI_ABORTWARNING

!insertmacro MUI_PAGE_WELCOME
!insertmacro MUI_PAGE_DIRECTORY
!insertmacro MUI_PAGE_INSTFILES
!insertmacro MUI_PAGE_FINISH

!insertmacro MUI_UNPAGE_INSTFILES

!insertmacro MUI_LANGUAGE "English"

Name "${INFO_PRODUCTNAME} v${INFO_PRODUCTVERSION}"
OutFile "..\..\..\bin\${INFO_PROJECTNAME}-v${INFO_PRODUCTVERSION}-windows-Universal.exe"

!if "${WAILS_INSTALL_SCOPE}" == "user"
    InstallDir "$LOCALAPPDATA\Programs\${INFO_PRODUCTNAME}"
!else
    InstallDir "$PROGRAMFILES64\${INFO_PRODUCTNAME}"
!endif
ShowInstDetails show

Function .onInit
   !insertmacro wails.checkArchitecture
   # Terminate running app before installing/updating
   DetailPrint "Closing running instances of ${PRODUCT_EXECUTABLE}..."
   nsExec::Exec 'taskkill /F /IM "${PRODUCT_EXECUTABLE}"'
   nsExec::Exec 'taskkill /F /IM "ThunderDM.exe"'
   Sleep 500
FunctionEnd

Function un.onInit
   # Terminate running app before uninstalling
   nsExec::Exec 'taskkill /F /IM "${PRODUCT_EXECUTABLE}"'
   nsExec::Exec 'taskkill /F /IM "ThunderDM.exe"'
   Sleep 500
FunctionEnd

Section
    !insertmacro wails.setShellContext

    # Terminate running app before copying new files
    nsExec::Exec 'taskkill /F /IM "${PRODUCT_EXECUTABLE}"'
    nsExec::Exec 'taskkill /F /IM "ThunderDM.exe"'
    Sleep 300

    !insertmacro wails.webview2runtime

    SetOutPath $INSTDIR
    
    !insertmacro wails.files

    CreateShortcut "$SMPROGRAMS\${INFO_PRODUCTNAME}.lnk" "$INSTDIR\${PRODUCT_EXECUTABLE}"
    CreateShortCut "$DESKTOP\${INFO_PRODUCTNAME}.lnk" "$INSTDIR\${PRODUCT_EXECUTABLE}"

    !insertmacro wails.associateFiles
    !insertmacro wails.associateCustomProtocols
    
    # Auto-start on Windows Startup in background mode
    WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "${INFO_PRODUCTNAME}" '"$INSTDIR\${PRODUCT_EXECUTABLE}" --startup'

    !insertmacro wails.writeUninstaller
SectionEnd

Section "uninstall" 
    !insertmacro wails.setShellContext

    # 1. Force kill any running app instance immediately
    DetailPrint "Terminating active ThunderDM processes..."
    nsExec::Exec 'taskkill /F /IM "${PRODUCT_EXECUTABLE}" /T'
    nsExec::Exec 'taskkill /F /IM "ThunderDM.exe" /T'
    Sleep 500

    # 2. Remove all shortcuts
    Delete "$SMPROGRAMS\${INFO_PRODUCTNAME}.lnk"
    Delete "$DESKTOP\${INFO_PRODUCTNAME}.lnk"
    Delete "$SMSTARTUP\${INFO_PRODUCTNAME}.lnk"
    Delete "$QUICKLAUNCH\${INFO_PRODUCTNAME}.lnk"
    RMDir /r "$SMPROGRAMS\ThunderDM\${INFO_PRODUCTNAME}"
    RMDir /r "$SMPROGRAMS\ThunderDM"

    # 3. Unassociate protocols & file extensions
    !insertmacro wails.unassociateFiles
    !insertmacro wails.unassociateCustomProtocols

    # 4. Remove user home database, AppData, LocalAppData, and WebView2 Caches
    DetailPrint "Purging user database, configurations, and caches..."
    RMDir /r "$PROFILE\.thunderdm"
    RMDir /r "$PROFILE\.ThunderDM"
    RMDir /r "$DOCUMENTS\..\.thunderdm"
    RMDir /r "$DOCUMENTS\..\.ThunderDM"
    RMDir /r "$LOCALAPPDATA\..\.thunderdm"
    RMDir /r "$LOCALAPPDATA\..\.ThunderDM"
    RMDir /r "$APPDATA\${INFO_PROJECTNAME}"
    RMDir /r "$APPDATA\${INFO_PRODUCTNAME}"
    RMDir /r "$LOCALAPPDATA\${INFO_PROJECTNAME}"
    RMDir /r "$LOCALAPPDATA\${INFO_PRODUCTNAME}"
    RMDir /r "$LOCALAPPDATA\${PRODUCT_EXECUTABLE}.WebView2"
    RMDir /r "$LOCALAPPDATA\ThunderDM.exe.WebView2"
    RMDir /r "$LOCALAPPDATA\Programs\${INFO_PRODUCTNAME}"

    # 5. Clean installation folder and all remaining files
    DetailPrint "Removing installation files..."
    Delete "$INSTDIR\${PRODUCT_EXECUTABLE}"
    Delete "$INSTDIR\*.exe"
    Delete "$INSTDIR\*.dll"
    Delete "$INSTDIR\*.log"
    Delete "$INSTDIR\*.json"
    Delete "$INSTDIR\*.txt"
    Delete "$INSTDIR\Uninstall.exe"
    RMDir /r "$INSTDIR"

    # 6. Clean Registry
    DeleteRegKey HKCU "Software\ThunderDM\${INFO_PRODUCTNAME}"
    DeleteRegKey HKCU "Software\ThunderDM"
    DeleteRegKey HKCU "Software\${UNINST_KEY_NAME}"
    DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "${INFO_PRODUCTNAME}"
    DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "ThunderDownloadManager"
    DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "ThunderDM"
    DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Explorer\StartupApproved\Run" "${INFO_PRODUCTNAME}"
    DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Explorer\StartupApproved\Run" "ThunderDownloadManager"
    DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Explorer\StartupApproved\Run" "ThunderDM"
    DeleteRegKey HKLM "Software\ThunderDM\${INFO_PRODUCTNAME}"
    DeleteRegKey HKLM "Software\ThunderDM"
    DeleteRegKey HKLM "${UNINST_KEY}"
    DeleteRegKey HKCU "${UNINST_KEY}"

    !insertmacro wails.deleteUninstaller
SectionEnd
