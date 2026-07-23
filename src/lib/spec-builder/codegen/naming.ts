// src/lib/spec-builder/codegen/naming.ts
//
// G7 W1 — the single source of truth for generated block/DB names. The SCL
// writers AND the HMI compiler both consume these helpers, so a rename in one
// place can never desynchronize the code from the HMI bindings. All helpers
// take the already-sclIdent'ed stem (the writers' existing convention).

/** Project-level maintenance seam DB (G3). */
export const MAINTENANCE_DB = "Maintenance_CMD";

/** Synthesized EM function block. */
export const emFbName = (emScl: string): string => `EM_${emScl}`;
/** EM instance DB — `.state` is the HMI's state-field binding. */
export const emDbName = (emScl: string): string => `EM_${emScl}_DB`;
/** EM command-seam DB — `sp_*` members are the HMI setpoint bindings. */
export const emCmdDbName = (emScl: string): string => `${emScl}_CMD`;

/** Unit coordinator FB / instance DB. */
export const ucFbName = (unitScl: string): string => `UC_${unitScl}`;
export const ucDbName = (unitScl: string): string => `UC_${unitScl}_DB`;
/** Unit PackTags DB (HMI/SCADA machine-data interface). */
export const unDbName = (unitScl: string): string => `UN_${unitScl}`;
/** Unit envelope config / status DBs (G2-5 / G4-2). */
export const cfgDbName = (unitScl: string): string => `CFG_${unitScl}`;
export const statDbName = (unitScl: string): string => `STAT_${unitScl}`;

/** Drive telegram-FB instance DB (G1-2), e.g. "SINA_SPEED_M1_DB". */
export const driveDbName = (fbName: string, cmScl: string): string => `${fbName}_${cmScl}_DB`;

/** Project-level IO conditioning layer (G1-4b). */
export const IO_COND_DB = "IO_Cond";
export const IO_COND_FB = "FB_IO_Conditioning";

/** G5-4 layer scaffolding (Pac Program Structure Standard v1). */
export const FC_INPUTS = "FC_Inputs";
export const FC_OUTPUTS = "FC_Outputs";
export const FC_MAINTENANCE = "FC_Maintenance";
export const FOLDER_SYSTEM = "00_System";
export const FOLDER_LIBRARY = "Library";
export const unitProcessFcName = (unitScl: string): string => `FC_${unitScl}_Process`;
export const unitManagementFcName = (unitScl: string): string => `FC_${unitScl}_Management`;
