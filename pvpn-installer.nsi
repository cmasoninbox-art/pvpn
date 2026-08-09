; PVPN Browser Extension Installer
; Installs the PVPN header-stripper extension for Chrome, Edge, and Firefox
; Build: makensis -V2 pvpn-installer.nsi

Unicode true
RequestExecutionLevel admin
SetCompressor /SOLID lzma

!include "LogicLib.nsh"
!include "WordFunc.nsh"

Name "PVPN Browser Extension"
OutFile "PVPN-Browser-Extension-Setup.exe"
InstallDir "$LOCALAPPDATA\PVPN\Extensions"
InstallDirRegKey HKCU "Software\PVPN\Extensions" "InstallDir"
ShowInstDetails show
ShowUnInstDetails show

; ---------- Pages ----------
Page directory
Page instfiles
UninstPage uninstConfirm
UninstPage instfiles

; ---------- Install ----------
Section "Install" SEC_MAIN
  SetOutPath "$INSTDIR\chrome"
  File /r "installer-src\chrome\*"

  SetOutPath "$INSTDIR\firefox"
  File /r "installer-src\firefox\*"

  ; Copy the firefox xpi alongside for policy-based install
  SetOutPath "$INSTDIR"
  File "public\vpn-browser-extension.xpi"

  ; Save install dir for uninstaller
  WriteRegStr HKCU "Software\PVPN\Extensions" "InstallDir" "$INSTDIR"

  ; ---------- Chrome shortcut (load-unpacked via --load-extension) ----------
  ReadRegStr $0 HKLM "SOFTWARE\Microsoft\Windows\CurrentVersion\App Paths\chrome.exe" ""
  ${If} $0 == ""
    ReadRegStr $0 HKLM "SOFTWARE\Google\Chrome\Path" ""
    ${If} $0 != ""
      StrCpy $0 "$0chrome.exe"
    ${EndIf}
  ${EndIf}
  ${If} $0 != ""
    CreateShortcut "$DESKTOP\PVPN Browser (Chrome).lnk" "$0" '--load-extension="$INSTDIR\chrome"' "$INSTDIR\chrome"
    CreateDirectory "$SMPROGRAMS\PVPN Browser"
    CreateShortcut "$SMPROGRAMS\PVPN Browser\PVPN Browser (Chrome).lnk" "$0" '--load-extension="$INSTDIR\chrome"' "$INSTDIR\chrome"
    DetailPrint "Chrome shortcut created: $0"
  ${Else}
    DetailPrint "Chrome not found - skipping Chrome shortcut"
  ${EndIf}

  ; ---------- Edge shortcut ----------
  ReadRegStr $0 HKLM "SOFTWARE\Microsoft\Windows\CurrentVersion\App Paths\msedge.exe" ""
  ${If} $0 == ""
    ReadRegStr $0 HKLM "SOFTWARE\Microsoft\Edge\Path" ""
    ${If} $0 != ""
      StrCpy $0 "$0msedge.exe"
    ${EndIf}
  ${EndIf}
  ${If} $0 != ""
    CreateShortcut "$DESKTOP\PVPN Browser (Edge).lnk" "$0" '--load-extension="$INSTDIR\chrome"' "$INSTDIR\chrome"
    CreateShortcut "$SMPROGRAMS\PVPN Browser\PVPN Browser (Edge).lnk" "$0" '--load-extension="$INSTDIR\chrome"' "$INSTDIR\chrome"
    DetailPrint "Edge shortcut created: $0"
  ${Else}
    DetailPrint "Edge not found - skipping Edge shortcut"
  ${EndIf}

  ; ---------- Firefox policy install ----------
  ; Detect Firefox install dir (64-bit then 32-bit view)
  SetRegView 64
  ReadRegStr $0 HKLM "SOFTWARE\Mozilla\Mozilla Firefox\CurrentVersion" "Path"
  ${If} $0 == ""
    SetRegView 32
    ReadRegStr $0 HKLM "SOFTWARE\Mozilla\Mozilla Firefox\CurrentVersion" "Path"
    SetRegView 64
  ${EndIf}
  ${If} $0 != ""
    ; $0 = firefox install dir ending with backslash. Build policies.json
    ; file:/// URL from $INSTDIR\xpi : C:\... -> file:///C:/...
    ${WordReplace} "$INSTDIR" "\" "/" "+" $1
    StrCpy $1 "file:///$1/vpn-browser-extension.xpi"
    ${If} $0 != ""
      CreateDirectory "$0distribution"
      ; Write policies.json
      FileOpen $2 "$0distribution\policies.json" w
      FileWrite $2 '{$\r$\n'
      FileWrite $2 '  "policies": {$\r$\n'
      FileWrite $2 '    "Extensions": {$\r$\n'
      FileWrite $2 '      "Install": [$\r$\n'
      FileWrite $2 '        "$1"$\r$\n'
      FileWrite $2 '      ]$\r$\n'
      FileWrite $2 '    },$\r$\n'
      FileWrite $2 '    "xpinstall": { "signatures_required": false }$\r$\n'
      FileWrite $2 '  }$\r$\n'
      FileWrite $2 '}$\r$\n'
      FileClose $2
      CreateShortcut "$DESKTOP\PVPN Browser (Firefox).lnk" "$0firefox.exe" "" "$INSTDIR\firefox"
      CreateShortcut "$SMPROGRAMS\PVPN Browser\PVPN Browser (Firefox).lnk" "$0firefox.exe" "" "$INSTDIR\firefox"
      DetailPrint "Firefox policy written to $0distribution\policies.json"
    ${EndIf}
  ${Else}
    DetailPrint "Firefox not found - skipping Firefox policy install"
  ${EndIf}

  ; ---------- Uninstaller ----------
  WriteUninstaller "$INSTDIR\Uninstall.exe"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\PVPNBrowserExt" "DisplayName" "PVPN Browser Extension"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\PVPNBrowserExt" "UninstallString" '"$INSTDIR\Uninstall.exe"'
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\PVPNBrowserExt" "InstallLocation" "$INSTDIR"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\PVPNBrowserExt" "DisplayVersion" "1.0.0"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\PVPNBrowserExt" "Publisher" "PVPN"
SectionEnd

; ---------- Uninstall ----------
Section "Uninstall"
  Delete "$DESKTOP\PVPN Browser (Chrome).lnk"
  Delete "$DESKTOP\PVPN Browser (Edge).lnk"
  Delete "$DESKTOP\PVPN Browser (Firefox).lnk"
  Delete "$SMPROGRAMS\PVPN Browser\PVPN Browser (Chrome).lnk"
  Delete "$SMPROGRAMS\PVPN Browser\PVPN Browser (Edge).lnk"
  Delete "$SMPROGRAMS\PVPN Browser\PVPN Browser (Firefox).lnk"
  RMDir "$SMPROGRAMS\PVPN Browser"

  ; Remove Firefox distribution policies we wrote
  SetRegView 64
  ReadRegStr $0 HKLM "SOFTWARE\Mozilla\Mozilla Firefox\CurrentVersion" "Path"
  ${If} $0 == ""
    SetRegView 32
    ReadRegStr $0 HKLM "SOFTWARE\Mozilla\Mozilla Firefox\CurrentVersion" "Path"
    SetRegView 64
  ${EndIf}
  ${If} $0 != ""
    Delete "$0distribution\policies.json"
    RMDir "$0distribution"
  ${EndIf}

  RMDir /r "$INSTDIR"
  DeleteRegKey HKCU "Software\PVPN\Extensions"
  DeleteRegKey HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\PVPNBrowserExt"
SectionEnd
