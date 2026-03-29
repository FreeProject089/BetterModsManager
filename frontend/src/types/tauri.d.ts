/**
 * tauri.d.ts — Global type declarations for Tauri v1 API
 * Injected by Tauri when withGlobalTauri is true in tauri.conf.json
 */

interface TauriDialogAPI {
  open(options?: {
    directory?: boolean;
    multiple?: boolean;
    filters?: Array<{ name: string; extensions: string[] }>;
  }): Promise<string | string[] | null>;
  save(options?: {
    filters?: Array<{ name: string; extensions: string[] }>;
  }): Promise<string | null>;
  confirm(message: string, options?: { title?: string; type?: string }): Promise<boolean>;
  ask(message: string, options?: { title?: string; type?: string }): Promise<boolean>;
  message(message: string, options?: { title?: string; type?: string }): Promise<void>;
}

interface TauriNotificationAPI {
  sendNotification(options: { title: string; body?: string }): void;
  isPermissionGranted(): Promise<boolean>;
  requestPermission(): Promise<string>;
}

interface TauriAppAPI {
  getVersion(): Promise<string>;
  getName(): Promise<string>;
  getTauriVersion(): Promise<string>;
}

interface TauriWindowAPI {
  appWindow: {
    minimize(): Promise<void>;
    toggleMaximize(): Promise<void>;
    close(): Promise<void>;
    startDragging(): Promise<void>;
    startResizing(direction: string): Promise<void>;
    isMaximized(): Promise<boolean>;
    onResized(handler: (event: unknown) => void): Promise<() => void>;
  };
}

interface TauriAPI {
  invoke(cmd: string, args?: Record<string, unknown>): Promise<unknown>;
  dialog: TauriDialogAPI;
  notification: TauriNotificationAPI;
  tauri: {
    invoke(cmd: string, args?: Record<string, unknown>): Promise<unknown>;
    convertFileSrc(path: string, protocol?: string): string;
  };
  app: TauriAppAPI;
  window: TauriWindowAPI;
}

declare interface Window {
  __TAURI__?: TauriAPI;
  _refreshModsFn?: (autoScan?: boolean) => Promise<void>;
  showTaskyHelp?: (key: string, icon: string) => void;
  hideTaskyHelp?: () => void;
  showProfiles?: () => void;
  openNewProfileModal?: () => void;
  openDocs?: (diagramId: string) => void;
  Cropper?: any;
}

// For dynamic ESM imports from CDN
declare module 'https://unpkg.com/@tauri-apps/api@1/tauri.js' {
  export function invoke(cmd: string, args?: Record<string, unknown>): Promise<unknown>;
  export function convertFileSrc(path: string, protocol?: string): string;
}

declare module 'https://unpkg.com/@tauri-apps/api@1/dialog.js' {
  export function open(options?: any): Promise<string | string[] | null>;
  export function save(options?: any): Promise<string | null>;
}

declare module 'https://unpkg.com/@tauri-apps/api@1/notification.js' {
  export function sendNotification(options: { title: string; body?: string }): void;
  export function isPermissionGranted(): Promise<boolean>;
  export function requestPermission(): Promise<string>;
}

declare module 'https://unpkg.com/@tauri-apps/api@1/event.js' {
  export function listen(event: string, handler: (event: { payload: any }) => void): Promise<() => void>;
  export function emit(event: string, payload?: any): Promise<void>;
}

declare module 'https://unpkg.com/@tauri-apps/api@1/window.js' {
  export const appWindow: any;
  export function getCurrent(): any;
}
