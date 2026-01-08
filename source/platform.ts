import os from 'os';

export const Platform = {
  windows: 'windows',
  macos: 'macos',
  linux: 'linux',
  other: 'other',
} as const;

export type PlatformKey = typeof Platform[keyof typeof Platform];

const PLATFORM_MAP: Record<string, PlatformKey> = {
  'win32': Platform.windows,
  'darwin': Platform.macos,
  'linux': Platform.linux,
};

export function getPlatform(): PlatformKey {
  const platform = os.platform();
  return PLATFORM_MAP[platform] || Platform.other;
}

export function isWindows(): boolean {
  return os.platform() === 'win32';
}

export function isMacOS(): boolean {
  return os.platform() === 'darwin';
}

export function isLinux(): boolean {
  return os.platform() === 'linux';
}
