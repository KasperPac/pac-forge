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
