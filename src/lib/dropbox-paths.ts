/**
 * dropbox-paths.ts
 * Derive TIA project and library paths from the machine-local Dropbox root.
 *
 * Folder convention:
 *   Projects:  {root}\Pac\Jobs\{Client Name}\{ClientCode} - {ProjectName}\50 PLC\
 *   Libraries: {root}\Pac\Engineering\Tia Portal Libraries\{LibraryName}\
 */

/**
 * Build the path to a TIA Portal global library folder.
 * The actual .al{version} file lives inside this folder.
 */
export function buildLibraryFolder(dropboxRoot: string, libraryName: string): string {
  return `${dropboxRoot}\\Pac\\Engineering\\Tia Portal Libraries\\${libraryName}`;
}

/**
 * Build the path to a project's PLC folder.
 * The .ap{version} file lives inside this folder.
 */
export function buildProjectPlcFolder(
  dropboxRoot: string,
  clientName: string,
  projectCode: string,
): string {
  return `${dropboxRoot}\\Pac\\Jobs\\${clientName}\\${projectCode}\\50 PLC`;
}

/**
 * Convert a Windows-local Dropbox folder path to a Dropbox API-relative path.
 * e.g. "C:\Users\kaspe\Pac Technologies Dropbox\Pac\Jobs\Client\PAC-2614 - Fans"
 *   → "/Pac/Jobs/Client/PAC-2614 - Fans"
 *
 * Strips the dropbox root prefix and converts backslashes to forward slashes.
 */
export function toDropboxApiPath(localPath: string, dropboxRoot: string): string | null {
  // Normalise separators for comparison
  const normLocal = localPath.replace(/\\/g, "/");
  const normRoot = dropboxRoot.replace(/\\/g, "/").replace(/\/+$/, "");
  if (!normLocal.startsWith(normRoot)) return null;
  const relative = normLocal.slice(normRoot.length);
  return relative.startsWith("/") ? relative : `/${relative}`;
}
