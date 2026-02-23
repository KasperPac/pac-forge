import type { languages, editor } from "monaco-editor";

export const SCL_LANGUAGE_ID = "scl";

export const sclLanguageConfig: languages.LanguageConfiguration = {
  comments: {
    lineComment: "//",
    blockComment: ["(*", "*)"],
  },
  brackets: [
    ["{", "}"],
    ["[", "]"],
    ["(", ")"],
  ],
  autoClosingPairs: [
    { open: "{", close: "}" },
    { open: "[", close: "]" },
    { open: "(", close: ")" },
    { open: "(*", close: "*)" },
    { open: "'", close: "'", notIn: ["string"] },
    { open: '"', close: '"', notIn: ["string"] },
  ],
  surroundingPairs: [
    { open: "{", close: "}" },
    { open: "[", close: "]" },
    { open: "(", close: ")" },
    { open: "'", close: "'" },
    { open: '"', close: '"' },
  ],
  folding: {
    markers: {
      start: /^\s*REGION\b/i,
      end: /^\s*END_REGION\b/i,
    },
  },
};

export const sclTokensProvider: languages.IMonarchLanguage = {
  defaultToken: "",
  ignoreCase: true,
  tokenPostfix: ".scl",

  keywords: [
    "FUNCTION_BLOCK", "END_FUNCTION_BLOCK",
    "FUNCTION", "END_FUNCTION",
    "DATA_BLOCK", "END_DATA_BLOCK",
    "ORGANIZATION_BLOCK", "END_ORGANIZATION_BLOCK",
    "TYPE", "END_TYPE",
    "PROGRAM", "END_PROGRAM",
    "VAR_INPUT", "VAR_OUTPUT", "VAR_IN_OUT", "VAR_TEMP", "VAR_STAT",
    "VAR", "END_VAR", "VAR_GLOBAL",
    "CONST", "END_CONST",
    "IF", "THEN", "ELSE", "ELSIF", "END_IF",
    "CASE", "OF", "END_CASE",
    "FOR", "TO", "BY", "DO", "END_FOR",
    "WHILE", "END_WHILE",
    "REPEAT", "UNTIL", "END_REPEAT",
    "RETURN", "EXIT", "CONTINUE", "GOTO",
    "REGION", "END_REGION",
    "STRUCT", "END_STRUCT",
    "ARRAY", "OF",
    "AT", "RETAIN", "NON_RETAIN",
    "TRUE", "FALSE",
    "AND", "OR", "XOR", "NOT",
    "MOD", "DIV",
    "REF_TO", "NULL",
  ],

  typeKeywords: [
    "BOOL", "BYTE", "WORD", "DWORD", "LWORD",
    "SINT", "INT", "DINT", "LINT",
    "USINT", "UINT", "UDINT", "ULINT",
    "REAL", "LREAL",
    "TIME", "LTIME", "DATE", "TOD", "LTOD", "DT", "LDT",
    "STRING", "WSTRING", "CHAR", "WCHAR",
    "S5TIME",
    "POINTER", "ANY",
    "VOID",
    "Timer", "IEC_Timer", "IEC_Counter",
    "TON", "TOF", "TP", "CTU", "CTD", "CTUD",
  ],

  operators: [
    ":=", "=>", ">=", "<=", "<>", "=", "<", ">",
    "+", "-", "*", "/", "**",
    "&", ".", ",", ";", ":", "(", ")", "[", "]", "{", "}",
    "#", "^",
  ],

  symbols: /[=><!~?:&|+\-*/^%]+/,

  escapes: /\\(?:[abfnrtv\\"']|x[0-9A-Fa-f]{1,4}|u[0-9A-Fa-f]{4}|U[0-9A-Fa-f]{8})/,

  tokenizer: {
    root: [
      // Block comments (* ... *)
      [/\(\*/, "comment", "@blockComment"],

      // Line comments
      [/\/\/.*$/, "comment"],

      // Pragma
      [/\{[^}]*\}/, "annotation"],

      // Identifiers and keywords
      [/[a-zA-Z_]\w*/, {
        cases: {
          "@keywords": "keyword",
          "@typeKeywords": "type",
          "@default": "identifier",
        },
      }],

      // Numbers
      [/16#[0-9A-Fa-f_]+/, "number.hex"],
      [/8#[0-7_]+/, "number.octal"],
      [/2#[01_]+/, "number.binary"],
      [/\d+\.\d+([eE][-+]?\d+)?/, "number.float"],
      [/\d+([eE][-+]?\d+)?/, "number"],

      // Time literals
      [/T#[\d_dhms.]+/i, "number"],
      [/LT#[\d_dhms.]+/i, "number"],
      [/S5T#[\d_dhms.]+/i, "number"],

      // Strings
      [/'([^'\\]|\\.)*$/, "string.invalid"],
      [/'/, "string", "@string_single"],
      [/"([^"\\]|\\.)*$/, "string.invalid"],
      [/"/, "string", "@string_double"],

      // Operators
      [/:=/, "delimiter"],
      [/[{}()[\]]/, "delimiter.bracket"],
      [/[<>]=?|<>|=/, "operator"],
      [/[+\-*/]/, "operator"],
      [/[;,.:^#]/, "delimiter"],

      // Whitespace
      [/\s+/, "white"],
    ],

    blockComment: [
      [/[^(*]+/, "comment"],
      [/\(\*/, "comment", "@push"],
      [/\*\)/, "comment", "@pop"],
      [/[(*]/, "comment"],
    ],

    string_single: [
      [/[^\\']+/, "string"],
      [/@escapes/, "string.escape"],
      [/\\./, "string.escape.invalid"],
      [/'/, "string", "@pop"],
    ],

    string_double: [
      [/[^\\"]+/, "string"],
      [/@escapes/, "string.escape"],
      [/\\./, "string.escape.invalid"],
      [/"/, "string", "@pop"],
    ],
  },
};

export const sclDarkTheme: editor.IStandaloneThemeData = {
  base: "vs-dark",
  inherit: true,
  rules: [
    { token: "keyword", foreground: "C586C0" },
    { token: "type", foreground: "4EC9B0" },
    { token: "identifier", foreground: "D4D4D4" },
    { token: "comment", foreground: "6A9955", fontStyle: "italic" },
    { token: "string", foreground: "CE9178" },
    { token: "string.escape", foreground: "D7BA7D" },
    { token: "number", foreground: "B5CEA8" },
    { token: "number.hex", foreground: "B5CEA8" },
    { token: "number.float", foreground: "B5CEA8" },
    { token: "operator", foreground: "D4D4D4" },
    { token: "delimiter", foreground: "808080" },
    { token: "delimiter.bracket", foreground: "D4D4D4" },
    { token: "annotation", foreground: "808080", fontStyle: "italic" },
  ],
  colors: {
    "editor.background": "#0a0a0a",
    "editor.foreground": "#d4d4d4",
    "editor.lineHighlightBackground": "#1a1a1a",
    "editor.selectionBackground": "#264f78",
    "editorCursor.foreground": "#d4d4d4",
    "editorLineNumber.foreground": "#505050",
    "editorLineNumber.activeForeground": "#808080",
  },
};

export function registerSclLanguage(monaco: typeof import("monaco-editor")) {
  if (!monaco.languages.getLanguages().some((lang) => lang.id === SCL_LANGUAGE_ID)) {
    monaco.languages.register({ id: SCL_LANGUAGE_ID });
  }
  monaco.languages.setLanguageConfiguration(SCL_LANGUAGE_ID, sclLanguageConfig);
  monaco.languages.setMonarchTokensProvider(SCL_LANGUAGE_ID, sclTokensProvider);
  monaco.editor.defineTheme("pac-dark", sclDarkTheme);
}
