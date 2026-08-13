!ifndef BUILD_UNINSTALLER

!include "nsDialogs.nsh"
!include "StrContains.nsh"

Var SeneraInstallationDialog
Var SeneraDataRootInput
Var SeneraWorkspaceRootInput
Var SeneraDataRootBrowseButton
Var SeneraWorkspaceRootBrowseButton
Var SeneraDataRoot
Var SeneraWorkspaceRoot
Var SeneraNormalizedDataRoot
Var SeneraNormalizedWorkspaceRoot
Var SeneraInstallationFileHandle
Var SeneraInstallationTempPath
Var SeneraSelectionHasVersion
Var SeneraSelectionHasDataRoot
Var SeneraSelectionHasWorkspaceRoot
Var SeneraSelectionValid

!macro customInit
  StrCpy $SeneraDataRoot "$APPDATA\${PRODUCT_NAME}"
  StrCpy $SeneraWorkspaceRoot "$DOCUMENTS"
!macroend

!macro customPageAfterChangeDir
  Page custom SeneraInstallationPageCreate SeneraInstallationPageLeave
!macroend

!macro customInstall
  Call SeneraHasValidInstallationSelection
  StrCmp $SeneraSelectionValid "1" senera_installation_configured
  Call SeneraWriteInstallationSelection
senera_installation_configured:
!macroend

Function SeneraInstallationPageCreate
  Call SeneraHasValidInstallationSelection
  StrCmp $SeneraSelectionValid "1" senera_skip_installation_selection

  nsDialogs::Create 1018
  Pop $SeneraInstallationDialog
  ${If} $SeneraInstallationDialog == error
    Abort
  ${EndIf}

  ${NSD_CreateLabel} 0 0 100% 28u "Senera 初始化"
  Pop $0
  ${NSD_CreateLabel} 0 30u 100% 30u "安装前选择一次数据目录和工作区。以后启动桌面端会直接使用这些路径，不再重复询问。"
  Pop $0

  ${NSD_CreateLabel} 0 70u 100% 12u "数据目录（缓存、日志、应用状态）"
  Pop $0
  ${NSD_CreateText} 0 84u 78% 14u "$SeneraDataRoot"
  Pop $SeneraDataRootInput
  ${NSD_CreateButton} 80% 84u 20% 14u "浏览..."
  Pop $SeneraDataRootBrowseButton
  ${NSD_OnClick} $SeneraDataRootBrowseButton SeneraSelectDataRoot

  ${NSD_CreateLabel} 0 116u 100% 12u "工作区目录（项目、.git、.senera 和会话状态）"
  Pop $0
  ${NSD_CreateText} 0 130u 78% 14u "$SeneraWorkspaceRoot"
  Pop $SeneraWorkspaceRootInput
  ${NSD_CreateButton} 80% 130u 20% 14u "浏览..."
  Pop $SeneraWorkspaceRootBrowseButton
  ${NSD_OnClick} $SeneraWorkspaceRootBrowseButton SeneraSelectWorkspaceRoot

  nsDialogs::Show
  Return

senera_skip_installation_selection:
  Abort
FunctionEnd

Function SeneraSelectDataRoot
  nsDialogs::SelectFolderDialog "选择 Senera 数据目录" "$SeneraDataRoot"
  Pop $0
  ${If} $0 != error
    StrCpy $SeneraDataRoot $0
    ${NSD_SetText} $SeneraDataRootInput $SeneraDataRoot
  ${EndIf}
FunctionEnd

Function SeneraSelectWorkspaceRoot
  nsDialogs::SelectFolderDialog "选择 Senera 工作区" "$SeneraWorkspaceRoot"
  Pop $0
  ${If} $0 != error
    StrCpy $SeneraWorkspaceRoot $0
    ${NSD_SetText} $SeneraWorkspaceRootInput $SeneraWorkspaceRoot
  ${EndIf}
FunctionEnd

Function SeneraInstallationPageLeave
  ${NSD_GetText} $SeneraDataRootInput $SeneraDataRoot
  ${NSD_GetText} $SeneraWorkspaceRootInput $SeneraWorkspaceRoot

  ${If} $SeneraDataRoot == ""
    MessageBox MB_OK|MB_ICONEXCLAMATION "请选择数据目录。"
    Abort
  ${EndIf}

  ${If} $SeneraWorkspaceRoot == ""
    MessageBox MB_OK|MB_ICONEXCLAMATION "请选择工作区目录。"
    Abort
  ${EndIf}

  IfFileExists "$SeneraWorkspaceRoot\." 0 senera_workspace_missing
  Return

senera_workspace_missing:
  MessageBox MB_OK|MB_ICONEXCLAMATION "工作区目录不存在，请选择一个已有的项目目录。"
  Abort
FunctionEnd

Function SeneraWriteInstallationSelection
  Call SeneraNormalizeDataRoot
  Call SeneraNormalizeWorkspaceRoot
  CreateDirectory "$SeneraDataRoot"
  CreateDirectory "$APPDATA\${PRODUCT_NAME}"

  StrCpy $SeneraInstallationTempPath "$SeneraDataRoot\installation.json.tmp"
  Call SeneraWriteSelectionFile
  Delete "$SeneraDataRoot\installation.json"
  Rename "$SeneraInstallationTempPath" "$SeneraDataRoot\installation.json"

  StrCpy $SeneraInstallationTempPath "$APPDATA\${PRODUCT_NAME}\installation.json.tmp"
  Call SeneraWriteSelectionFile
  Delete "$APPDATA\${PRODUCT_NAME}\installation.json"
  Rename "$SeneraInstallationTempPath" "$APPDATA\${PRODUCT_NAME}\installation.json"
FunctionEnd

Function SeneraHasValidInstallationSelection
  StrCpy $SeneraSelectionHasVersion "0"
  StrCpy $SeneraSelectionHasDataRoot "0"
  StrCpy $SeneraSelectionHasWorkspaceRoot "0"
  StrCpy $SeneraSelectionValid "0"
  IfFileExists "$APPDATA\${PRODUCT_NAME}\installation.json" 0 senera_selection_validation_done
  FileOpen $SeneraInstallationFileHandle "$APPDATA\${PRODUCT_NAME}\installation.json" r
  IfErrors senera_selection_validation_done

senera_selection_validation_read:
  FileRead $SeneraInstallationFileHandle $0
  IfErrors senera_selection_validation_close
  ${StrContains} $1 "$\"version$\": 1" $0
  StrCmp $1 "" 0 senera_selection_found_version
  ${StrContains} $1 "$\"dataRoot$\":" $0
  StrCmp $1 "" 0 senera_selection_found_data_root
  ${StrContains} $1 "$\"workspaceRoot$\":" $0
  StrCmp $1 "" 0 senera_selection_found_workspace_root
  Goto senera_selection_validation_read

senera_selection_found_version:
  StrCpy $SeneraSelectionHasVersion "1"
  Goto senera_selection_validation_read

senera_selection_found_data_root:
  StrCpy $SeneraSelectionHasDataRoot "1"
  Goto senera_selection_validation_read

senera_selection_found_workspace_root:
  StrCpy $SeneraSelectionHasWorkspaceRoot "1"
  Goto senera_selection_validation_read

senera_selection_validation_close:
  FileClose $SeneraInstallationFileHandle
  StrCmp $SeneraSelectionHasVersion "1" 0 senera_selection_validation_done
  StrCmp $SeneraSelectionHasDataRoot "1" 0 senera_selection_validation_done
  StrCmp $SeneraSelectionHasWorkspaceRoot "1" 0 senera_selection_validation_done
  StrCpy $SeneraSelectionValid "1"

senera_selection_validation_done:
FunctionEnd

Function SeneraWriteSelectionFile
  FileOpen $SeneraInstallationFileHandle "$SeneraInstallationTempPath" w
  FileWrite $SeneraInstallationFileHandle "{$\r$\n"
  FileWrite $SeneraInstallationFileHandle "  $\"version$\": 1,$\r$\n"
  FileWrite $SeneraInstallationFileHandle "  $\"dataRoot$\": $\"$SeneraNormalizedDataRoot$\",$\r$\n"
  FileWrite $SeneraInstallationFileHandle "  $\"workspaceRoot$\": $\"$SeneraNormalizedWorkspaceRoot$\"$\r$\n"
  FileWrite $SeneraInstallationFileHandle "}$\r$\n"
  FileClose $SeneraInstallationFileHandle
FunctionEnd

Function SeneraNormalizeDataRoot
  Push $SeneraDataRoot
  Call SeneraNormalizePath
  Pop $SeneraNormalizedDataRoot
FunctionEnd

Function SeneraNormalizeWorkspaceRoot
  Push $SeneraWorkspaceRoot
  Call SeneraNormalizePath
  Pop $SeneraNormalizedWorkspaceRoot
FunctionEnd

Function SeneraNormalizePath
  Exch $0
  Push $1
  Push $2
  StrCpy $1 ""
senera_normalize_path_loop:
  StrCpy $2 $0 1
  StrCmp $2 "" senera_normalize_path_done
  StrCmp $2 "\" senera_normalize_path_separator
  StrCpy $1 "$1$2"
  StrCpy $0 $0 "" 1
  Goto senera_normalize_path_loop
senera_normalize_path_separator:
  StrCpy $1 "$1/"
  StrCpy $0 $0 "" 1
  Goto senera_normalize_path_loop
senera_normalize_path_done:
  StrCpy $0 $1
  Pop $2
  Pop $1
  Exch $0
FunctionEnd

!endif
