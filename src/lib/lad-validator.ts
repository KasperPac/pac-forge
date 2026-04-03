import type { LadNode, LadProgram, LadSeriesChain } from "@/types/lad";
import { isOutputElement, LAD_ELEMENT_TYPES } from "@/types/lad";

export interface LadValidationIssue {
  severity: "error" | "warning";
  message: string;
}

export interface LadValidationResult {
  issues: LadValidationIssue[];
}

function extractDbReferenceName(operand: string | undefined): string | null {
  if (!operand) return null;
  const quotedMatch = operand.match(/^"([^"]+)"\./);
  if (quotedMatch) return quotedMatch[1];
  const bareMatch = operand.match(/^(DB_[A-Za-z0-9_]+)\./);
  if (bareMatch) return bareMatch[1];
  return null;
}

function collectNodes(chain: LadSeriesChain): LadNode[] {
  const nodes: LadNode[] = [];
  for (const node of chain.nodes) {
    nodes.push(node);
    if (node.type === "parallel") {
      for (const branch of node.branches) {
        nodes.push(...collectNodes(branch));
      }
    }
  }
  return nodes;
}

function hasConditionPath(nodes: LadNode[]): boolean {
  return nodes.some((node) => {
    if (node.type === "parallel") {
      return node.branches.some((branch) => hasConditionPath(branch.nodes));
    }
    if (node.element.type === "FB_CALL") return false;
    return !isOutputElement(node.element.type);
  });
}

export function validateLadProgram(
  program: LadProgram,
  options: {
    validDbNames?: string[];
    allowedElementTypes?: string[];
  } = {},
): LadValidationResult {
  const issues: LadValidationIssue[] = [];
  const allowedTypes = new Set<string>([
    ...Object.values(LAD_ELEMENT_TYPES),
    ...(options.allowedElementTypes ?? []),
  ]);
  const validDbNames = new Set(options.validDbNames ?? []);

  for (const rung of program.rungs ?? []) {
    const flatNodes = collectNodes(rung.logic);
    const outputNodes = flatNodes.filter(
      (node): node is Extract<LadNode, { type: "element" }> =>
        node.type === "element" && isOutputElement(node.element.type),
    );

    if (outputNodes.length > 0 && !hasConditionPath(rung.logic.nodes.slice(0, -1))) {
      issues.push({
        severity: "error",
        message: `Rung "${rung.title}" has an output coil without a preceding condition path`,
      });
    }

    for (const node of flatNodes) {
      if (node.type !== "element") continue;
      if (!allowedTypes.has(node.element.type)) {
        issues.push({
          severity: "error",
          message: `Rung "${rung.title}" uses unsupported LAD element type "${node.element.type}"`,
        });
      }

      const operands = [
        node.element.operand,
        node.element.operand2,
        node.element.outputOperand,
        node.element.instanceDb,
        node.element.fbInstanceDb,
      ];
      for (const operand of operands) {
        const dbName = extractDbReferenceName(operand);
        if (dbName && validDbNames.size > 0 && !validDbNames.has(dbName)) {
          issues.push({
            severity: "error",
            message: `Rung "${rung.title}" references unknown DB "${dbName}"`,
          });
        }
      }

      for (const param of node.element.callParams ?? []) {
        const dbName = extractDbReferenceName(param.value);
        if (dbName && validDbNames.size > 0 && !validDbNames.has(dbName)) {
          issues.push({
            severity: "error",
            message: `Rung "${rung.title}" FB call param "${param.name}" references unknown DB "${dbName}"`,
          });
        }
      }
    }
  }

  return { issues };
}
