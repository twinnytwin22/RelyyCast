; RelyyCast NSIS Installer Script
; Built with NSIS 3.x + MUI2
; Run via: makensis relyycast.nsi  (from scripts/installers/windows/)

; -----------------------------------------------------------------------
; Defines
; -----------------------------------------------------------------------
!define APP_NAME      "RelyyCast"
!define APP_VERSION   "0.1.0"
!define APP_PUBLISHER "Randal Herndon"
!define APP_URL       "https://relyycast.app"
!define APP_EXE       "relyycast-win_x64.exe"
!define REG_KEY       "Software\${APP_NAME}"
!define UNINSTALL_KEY "Software\Microsoft\Windows\CurrentVersion\Uninstall\${APP_NAME}"

; Source files relative to this .nsi file (scripts/installers/windows/)
!define DIST_SRC      "${__FILEDIR__}\..\..\..\dist\relyycast"
!define ICON_SRC      "${__FILEDIR__}\..\..\..\public\favicon.ico"
!define LICENSE_SRC   "${__FILEDIR__}\..\..\..\LICENSE"

; Output
!define INSTALLER_OUT "${__FILEDIR__}\..\..\..\dist\relyycast-setup.exe"

; -----------------------------------------------------------------------
; General
; -----------------------------------------------------------------------
Name    "${APP_NAME} ${APP_VERSION}"
OutFile "${INSTALLER_OUT}"
Unicode True
SetCompressor /SOLID lzma

InstallDir          "$PROGRAMFILES64\${APP_NAME}"
InstallDirRegKey    HKLM "${REG_KEY}" "InstallDir"
RequestExecutionLevel admin

; -----------------------------------------------------------------------
; MUI2 Setup
; -----------------------------------------------------------------------
!include "MUI2.nsh"
!include "Sections.nsh"

!define MUI_ABORTWARNING
!define MUI_ICON    "${ICON_SRC}"
!define MUI_UNICON  "${ICON_SRC}"

!define MUI_WELCOMEPAGE_TITLE   "Welcome to the ${APP_NAME} Setup Wizard"
!define MUI_WELCOMEPAGE_TEXT    "This wizard will guide you through the installation of ${APP_NAME} ${APP_VERSION}.$\r$\n$\r$\nRelyyCast is a live radio streaming tool with built-in HLS/RTMP support via MediaMTX and Cloudflare Tunnel.$\r$\n$\r$\nClick Next to continue."

!define MUI_FINISHPAGE_RUN         "$INSTDIR\${APP_EXE}"
!define MUI_FINISHPAGE_RUN_TEXT    "Launch ${APP_NAME}"
!define MUI_FINISHPAGE_SHOWREADME  ""

; Installer Pages
!insertmacro MUI_PAGE_WELCOME
!insertmacro MUI_PAGE_LICENSE "${LICENSE_SRC}"
!insertmacro MUI_PAGE_COMPONENTS
!insertmacro MUI_PAGE_DIRECTORY
!insertmacro MUI_PAGE_INSTFILES
!insertmacro MUI_PAGE_FINISH

; Uninstaller Pages
!insertmacro MUI_UNPAGE_CONFIRM
!insertmacro MUI_UNPAGE_INSTFILES

!insertmacro MUI_LANGUAGE "English"

; -----------------------------------------------------------------------
; Installer Init
; -----------------------------------------------------------------------
Function .onInit
  ; Best-effort: stop running processes that can lock binaries during upgrade.
  ExecWait '"$SYSDIR\taskkill.exe" /F /IM ${APP_EXE} /T'
  ExecWait '"$SYSDIR\taskkill.exe" /F /IM mediamtx.exe /T'
  ExecWait '"$SYSDIR\taskkill.exe" /F /IM cloudflared.exe /T'
  Sleep 500
FunctionEnd

; -----------------------------------------------------------------------
; Version Info (shown in Properties > Details)
; -----------------------------------------------------------------------
VIProductVersion "0.1.0.0"
VIAddVersionKey "ProductName"      "${APP_NAME}"
VIAddVersionKey "ProductVersion"   "${APP_VERSION}"
VIAddVersionKey "CompanyName"      "${APP_PUBLISHER}"
VIAddVersionKey "FileDescription"  "${APP_NAME} Installer"
VIAddVersionKey "FileVersion"      "${APP_VERSION}"
VIAddVersionKey "LegalCopyright"   "Copyright (c) 2026 ${APP_PUBLISHER}"

; -----------------------------------------------------------------------
; Section: Core Application (required)
; -----------------------------------------------------------------------
Section "!${APP_NAME} (required)" SEC_CORE
  SectionIn RO  ; always installed, greyed-out checkbox

  ; Core binary + resource archive
  SetOutPath "$INSTDIR"
  File "${DIST_SRC}\relyycast-win_x64.exe"
  File "${DIST_SRC}\resources.neu"

  ; MediaMTX streaming server
  SetOutPath "$INSTDIR\build\mediamtx\win"
  ClearErrors
  File /nonfatal "${DIST_SRC}\build\mediamtx\win\mediamtx.exe"
  IfErrors 0 mediamtx_done
    ExecWait '"$SYSDIR\taskkill.exe" /F /IM mediamtx.exe /T'
    Sleep 500
    ClearErrors
    File /nonfatal "${DIST_SRC}\build\mediamtx\win\mediamtx.exe"
    IfErrors 0 mediamtx_done
      MessageBox MB_ICONSTOP|MB_OK "Failed to install mediamtx.exe. Close RelyyCast and retry."
      Abort
  mediamtx_done:

  SetOutPath "$INSTDIR\build\mediamtx"
  File "${DIST_SRC}\build\mediamtx\mediamtx.yml"

  ; Cloudflare Tunnel binary
  SetOutPath "$INSTDIR\build\bin"
  ClearErrors
  File /nonfatal "${DIST_SRC}\build\bin\cloudflared.exe"
  IfErrors 0 cloudflared_done
    ExecWait '"$SYSDIR\taskkill.exe" /F /IM cloudflared.exe /T'
    Sleep 500
    ClearErrors
    File /nonfatal "${DIST_SRC}\build\bin\cloudflared.exe"
    IfErrors 0 cloudflared_done
      MessageBox MB_ICONSTOP|MB_OK "Failed to install cloudflared.exe. Close RelyyCast and retry."
      Abort
  cloudflared_done:

  ; Registry: install location + version
  WriteRegStr HKLM "${REG_KEY}" "InstallDir" "$INSTDIR"
  WriteRegStr HKLM "${REG_KEY}" "Version"    "${APP_VERSION}"

  ; Add / Remove Programs entry
  WriteRegStr   HKLM "${UNINSTALL_KEY}" "DisplayName"     "${APP_NAME}"
  WriteRegStr   HKLM "${UNINSTALL_KEY}" "DisplayVersion"  "${APP_VERSION}"
  WriteRegStr   HKLM "${UNINSTALL_KEY}" "Publisher"       "${APP_PUBLISHER}"
  WriteRegStr   HKLM "${UNINSTALL_KEY}" "URLInfoAbout"    "${APP_URL}"
  WriteRegStr   HKLM "${UNINSTALL_KEY}" "UninstallString" "$\"$INSTDIR\Uninstall.exe$\""
  WriteRegStr   HKLM "${UNINSTALL_KEY}" "InstallLocation" "$\"$INSTDIR$\""
  WriteRegStr   HKLM "${UNINSTALL_KEY}" "DisplayIcon"     "$\"$INSTDIR\${APP_EXE}$\""
  WriteRegDWORD HKLM "${UNINSTALL_KEY}" "NoModify"        1
  WriteRegDWORD HKLM "${UNINSTALL_KEY}" "NoRepair"        1
  WriteRegDWORD HKLM "${UNINSTALL_KEY}" "EstimatedSize"   50000

  WriteUninstaller "$INSTDIR\Uninstall.exe"
SectionEnd

; -----------------------------------------------------------------------
; Section Group: Shortcuts
; -----------------------------------------------------------------------
SectionGroup /e "Shortcuts" SEC_GRP_SHORTCUTS

  Section "Start Menu shortcut" SEC_STARTMENU
    CreateDirectory "$SMPROGRAMS\${APP_NAME}"
    CreateShortCut  "$SMPROGRAMS\${APP_NAME}\${APP_NAME}.lnk"  "$INSTDIR\${APP_EXE}"
    CreateShortCut  "$SMPROGRAMS\${APP_NAME}\Uninstall.lnk"    "$INSTDIR\Uninstall.exe"
  SectionEnd

  Section /o "Desktop shortcut" SEC_DESKTOP
    CreateShortCut "$DESKTOP\${APP_NAME}.lnk" "$INSTDIR\${APP_EXE}"
  SectionEnd

SectionGroupEnd

; -----------------------------------------------------------------------
; Component Descriptions
; -----------------------------------------------------------------------
!insertmacro MUI_FUNCTION_DESCRIPTION_BEGIN
  !insertmacro MUI_DESCRIPTION_TEXT ${SEC_CORE}         "The RelyyCast application, MediaMTX streaming server, and Cloudflare Tunnel binary. Required."
  !insertmacro MUI_DESCRIPTION_TEXT ${SEC_GRP_SHORTCUTS} "Create shortcuts for quick access to ${APP_NAME}."
  !insertmacro MUI_DESCRIPTION_TEXT ${SEC_STARTMENU}    "Add ${APP_NAME} to the Start Menu."
  !insertmacro MUI_DESCRIPTION_TEXT ${SEC_DESKTOP}      "Add a shortcut to your Desktop."
!insertmacro MUI_FUNCTION_DESCRIPTION_END

; -----------------------------------------------------------------------
; Uninstaller
; -----------------------------------------------------------------------
Section "Uninstall"
  ; Remove all installed files
  Delete "$INSTDIR\${APP_EXE}"
  Delete "$INSTDIR\resources.neu"
  Delete "$INSTDIR\Uninstall.exe"

  RMDir /r "$INSTDIR\build"
  RMDir    "$INSTDIR"

  ; Remove shortcuts
  Delete "$SMPROGRAMS\${APP_NAME}\${APP_NAME}.lnk"
  Delete "$SMPROGRAMS\${APP_NAME}\Uninstall.lnk"
  RMDir  "$SMPROGRAMS\${APP_NAME}"
  Delete "$DESKTOP\${APP_NAME}.lnk"

  ; Remove registry entries
  DeleteRegKey HKLM "${UNINSTALL_KEY}"
  DeleteRegKey HKLM "${REG_KEY}"
SectionEnd
