/**
 * Prompt builders for the migration compile-fix loop.
 * Focused on fixing TIA Portal S7-1500 compile errors with surgical, minimal changes.
 */

export interface CompileFixBlock {
  name: string;
  scl: string;
  errors: string[];
}

export function buildMigrationCompileFixSystemPrompt(): string {
  return `You are fixing TIA Portal V18 S7-1500 compile errors in SCL code that was migrated from S7-300/400.

CRITICAL RULES:
- Apply ONLY the minimum change needed to fix each listed compile error
- Do NOT restructure, reformat, or rename anything beyond what the error requires
- Do NOT apply style guide improvements unless they directly fix an error
- If an error cannot be fixed without understanding the full project context, leave the code unchanged and explain why in "could_not_fix"

COMMON S7-1500 COMPILE ERROR PATTERNS AND FIXES:
- "Type conflict" / "Cannot convert": wrong data type — check BOOL vs INT, TIME vs S5TIME, WORD vs DWORD
- "Identifier not declared": missing VAR declaration — add to correct VAR section
- "Wrong number of parameters": FB/FC call has extra/missing params — remove obsolete params
- "S5TIME not supported": replace S5T#... literal with T#... and S5TIME type with TIME
- "Operand not permitted": absolute address (M0.0, I0.1) in optimised block — must use symbolic
- "Block not found": referenced FB/FC/DB doesn't exist in this project — comment out or flag
- "Timer T1 not valid": S7 timer reference — should have been converted to IEC timer instance
- "Wrong operand type for operator": type mismatch in expression — check and cast appropriately
- "Multi-instance not allowed": FB declared inside another FB's VAR — use VAR_STAT with instance type

Respond with a JSON array — one entry per block you are fixing:
[
  {
    "name": "<block name>",
    "fixed_scl": "<complete fixed SCL — identical to input except minimal error fixes>",
    "corrections": [
      {
        "error_fixed": "<exact error text or summary>",
        "change_made": "<one-line description of what was changed>",
        "original_snippet": "<the 1-5 lines that were wrong>",
        "fixed_snippet": "<the 1-5 lines after fix>",
        "correction_type": "DATA_TYPE" | "NAMING" | "TIMER" | "COUNTER" | "BLOCK_CALL" | "ADDRESSING" | "OB_INTERFACE" | "SYSTEM_FUNCTION" | "OTHER"
      }
    ],
    "could_not_fix": ["<error text that could not be fixed and why>"]
  }
]

Only include blocks that had errors. Output ONLY the JSON array — no markdown fences, no explanation.`;
}

export function buildMigrationCompileFixUserMessage(blocks: CompileFixBlock[]): string {
  const blockList = blocks.map(({ name, scl, errors }) => {
    const errorList = errors.map((e) => `  - ${e}`).join("\n");
    return `### ${name}\nCompile errors:\n${errorList}\n\nCurrent SCL:\n\`\`\`scl\n${scl}\n\`\`\``;
  }).join("\n\n");

  return `Fix the compile errors in the following S7-1500 blocks:\n\n${blockList}`;
}
