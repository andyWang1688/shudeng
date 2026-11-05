export interface ModelDirectories {
  readonly staging: string;
  readonly installed: string;
  readonly backup: string;
}
export interface ModelDirectoryIO {
  exists(path: string): boolean;
  move(source: string, destination: string): void;
  remove(path: string): void;
}

/** All paths are immutable: Expo Directory.move mutates the source Directory object's URI. */
export function promoteModelDirectory(
  paths: ModelDirectories,
  io: ModelDirectoryIO,
): void {
  if (io.exists(paths.installed)) io.move(paths.installed, paths.backup);
  try {
    io.move(paths.staging, paths.installed);
  } catch (error) {
    if (io.exists(paths.installed)) io.remove(paths.installed);
    if (io.exists(paths.backup)) io.move(paths.backup, paths.installed);
    throw error;
  }
  if (io.exists(paths.backup)) io.remove(paths.backup);
}
