# Relyy Chrome Porting Guide

This guide shows how to reuse the same header window chrome and footer status bar in another Electron + React app while keeping the exact visual language and behavior.

## Source Components To Reuse

Copy these files into your target repo (preserve relative structure if possible):

- `components/chrome/AppWindowChrome.tsx`
- `components/chrome/AppStatusFooter.tsx`
- `hooks/useWindowChrome.ts`

Reference implementation in this repo:

- `components/chrome/AppWindowChrome.tsx`
- `components/chrome/AppStatusFooter.tsx`
- `hooks/useWindowChrome.ts`

## Required Renderer Contracts

Your target app needs a compatible `window.electronAPI` bridge with:

- `platform`
- `minimize()`
- `toggleMaximize()`
- `close()`
- `getWindowState()`
- `onWindowStateChange(listener)`

Reference types:

- `lib/platform/electron.ts` (`WindowState`, `ElectronAPI`)

Reference bridge wiring:

- `electron/preload.ts`

## Required Main Process Wiring

Make sure your Electron main process supports:

1. BrowserWindow chrome strategy
   - macOS: framed hidden-inset titlebar
   - others: frameless custom controls
2. Window state push events (`window:state-changed`)
3. IPC handlers:
   - `window:minimize`
   - `window:toggle-maximize`
   - `window:close`
   - `window:get-state`

Reference implementation:

- `electron/main.ts`

## Theme / Brand Language Requirements

Keep the same CSS token model so dark/light rendering stays consistent:

- `--theme-bg`
- `--theme-surface`
- `--theme-border`
- `--theme-text`
- `--theme-muted`
- `--theme-primary`
- `--theme-accent`

Reference token application:

- `lib/theme.ts`

## Minimal Usage Example

Use the extracted components from your dashboard/shell container:

```tsx
import AppStatusFooter from "@/components/chrome/AppStatusFooter";
import AppWindowChrome from "@/components/chrome/AppWindowChrome";

<AppWindowChrome
  stationName={stationSettings.stationName}
  logoMode={stationSettings.logoMode}
  logoIcon={stationSettings.logoIcon}
  logoImageUri={stationSettings.logoImageUri}
  darkMode={darkMode}
  currentTimeLabel={currentTimeLabel}
  currentDateLabel={currentDateLabel}
  enabledRuleCount={enabledRuleCount}
  onToggleDarkMode={() => setDarkMode((v) => !v)}
  onOpenSchedule={() => setScheduleOpen(true)}
  onOpenSettings={() => setSettingsOpen(true)}
  onToggleHardware={() => setHardwareOpen((v) => !v)}
/>

<AppStatusFooter
  currentItem={currentItem}
  queue={queue}
  bpmAnalysisProgress={bpmAnalysisProgress}
  showDetailedDashboardBpm={showDetailedDashboardBpm}
  storageBusy={storageBusy}
  storageError={storageError}
  broadcastStatus={broadcastStatus}
  stationSettings={stationSettings}
  streamUrl={streamUrl}
/>
```

## AppStatusFooter Data Shape Notes

`AppStatusFooter` expects domain objects from this app's radio model:

- `QueueItem`
- `BroadcastStatus`
- `StationSettings`
- `LibraryBpmAnalysisProgress`

If your target app uses different models, create a small adapter layer in the target repo:

- map your queue entries to `title`, `duration`
- map stream readiness to `broadcastStatus.encoderReady`
- map stream mount path to `stationSettings.streamMount`
- map analysis job info to `bpmAnalysisProgress`

## Migration Checklist

- [ ] Copy chrome components + hook
- [ ] Add `electronAPI` bridge methods in preload
- [ ] Add IPC handlers and state event emitter in main process
- [ ] Ensure titlebar drag/no-drag regions are enabled in renderer
- [ ] Ensure theme CSS variables exist
- [ ] Build and verify on macOS and non-macOS
- [ ] Verify window controls minimize/maximize/close
- [ ] Verify stream popover and status badges

## Known Gotcha

In this repo, `electron/preload.ts` currently includes a `maximize` invoke channel named `window:maximaze` (typo) that is not used by the extracted chrome component. If you add a dedicated maximize API in another repo, use a correctly named channel and keep it consistent with `ipcMain` handlers.
