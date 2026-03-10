/**
 * Properties panel for editing selected ladder element properties.
 */

import type { LadElement, LadCmpOperator, LadMathOperator } from "@/types/lad";
import { LAD_ELEMENT_LABELS, LAD_CMP_OPERATORS, LAD_MATH_OPERATORS, isBoxElement, isOutputElement } from "@/types/lad";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";

interface LadPropertiesPanelProps {
  element: LadElement | null;
  onUpdate: (id: string, patch: Partial<LadElement>) => void;
}

export function LadPropertiesPanel({ element, onUpdate }: LadPropertiesPanelProps) {
  if (!element) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
        Select an element to edit
      </div>
    );
  }

  const isBox = isBoxElement(element.type);
  const isOutput = isOutputElement(element.type);

  return (
    <div className="space-y-4 p-3">
      {/* Element type badge */}
      <div className="flex items-center gap-2">
        <Badge variant={isOutput ? "default" : isBox ? "secondary" : "outline"}>
          {LAD_ELEMENT_LABELS[element.type]}
        </Badge>
        <span className="font-mono text-[10px] text-muted-foreground">{element.id}</span>
      </div>

      {/* Primary operand */}
      <div className="space-y-1">
        <Label className="text-xs">
          {element.type === "CMP" || element.type === "MATH" ? "Operand 1" : "Operand"}
        </Label>
        <Input
          value={element.operand}
          onChange={(e) => onUpdate(element.id, { operand: e.target.value })}
          className="h-8 font-mono text-xs"
          placeholder="Tag name..."
        />
      </div>

      {/* Data type (for typed elements) */}
      {(element.type === "CMP" || element.type === "MATH" || element.type === "MOVE") && (
        <div className="space-y-1">
          <Label className="text-xs">Data Type</Label>
          <Select
            value={element.dataType ?? "Int"}
            onValueChange={(v) => onUpdate(element.id, { dataType: v })}
          >
            <SelectTrigger className="h-8 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="Bool">Bool</SelectItem>
              <SelectItem value="Int">Int</SelectItem>
              <SelectItem value="DInt">DInt</SelectItem>
              <SelectItem value="Real">Real</SelectItem>
              <SelectItem value="LReal">LReal</SelectItem>
              <SelectItem value="Word">Word</SelectItem>
              <SelectItem value="DWord">DWord</SelectItem>
              <SelectItem value="Time">Time</SelectItem>
            </SelectContent>
          </Select>
        </div>
      )}

      {/* Comparison operator */}
      {element.type === "CMP" && (
        <div className="space-y-1">
          <Label className="text-xs">Operator</Label>
          <Select
            value={element.cmpOperator ?? "=="}
            onValueChange={(v) => onUpdate(element.id, { cmpOperator: v as LadCmpOperator })}
          >
            <SelectTrigger className="h-8 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {LAD_CMP_OPERATORS.map((op) => (
                <SelectItem key={op} value={op}>{op}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}

      {/* Math operator */}
      {element.type === "MATH" && (
        <div className="space-y-1">
          <Label className="text-xs">Operation</Label>
          <Select
            value={element.mathOperator ?? "ADD"}
            onValueChange={(v) => onUpdate(element.id, { mathOperator: v as LadMathOperator })}
          >
            <SelectTrigger className="h-8 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {LAD_MATH_OPERATORS.map((op) => (
                <SelectItem key={op} value={op}>{op}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}

      {/* Second operand (CMP, MATH) */}
      {(element.type === "CMP" || element.type === "MATH") && (
        <div className="space-y-1">
          <Label className="text-xs">Operand 2</Label>
          <Input
            value={element.operand2 ?? ""}
            onChange={(e) => onUpdate(element.id, { operand2: e.target.value })}
            className="h-8 font-mono text-xs"
            placeholder="Tag or literal..."
          />
        </div>
      )}

      {/* Output operand (MATH, MOVE) */}
      {(element.type === "MATH" || element.type === "MOVE") && (
        <div className="space-y-1">
          <Label className="text-xs">Output</Label>
          <Input
            value={element.outputOperand ?? ""}
            onChange={(e) => onUpdate(element.id, { outputOperand: e.target.value })}
            className="h-8 font-mono text-xs"
            placeholder="Output tag..."
          />
        </div>
      )}

      {/* Timer preset */}
      {(element.type === "TON" || element.type === "TOF") && (
        <>
          <div className="space-y-1">
            <Label className="text-xs">Preset Time</Label>
            <Input
              value={element.presetTime ?? "T#1s"}
              onChange={(e) => onUpdate(element.id, { presetTime: e.target.value })}
              className="h-8 font-mono text-xs"
              placeholder="T#5s"
            />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Instance DB</Label>
            <Input
              value={element.instanceDb ?? ""}
              onChange={(e) => onUpdate(element.id, { instanceDb: e.target.value })}
              className="h-8 font-mono text-xs"
              placeholder="TON_Instance"
            />
          </div>
        </>
      )}

      {/* Counter preset */}
      {(element.type === "CTU" || element.type === "CTD") && (
        <>
          <div className="space-y-1">
            <Label className="text-xs">Preset Count</Label>
            <Input
              type="number"
              value={element.presetCount ?? 10}
              onChange={(e) => onUpdate(element.id, { presetCount: parseInt(e.target.value) || 0 })}
              className="h-8 font-mono text-xs"
            />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Instance DB</Label>
            <Input
              value={element.instanceDb ?? ""}
              onChange={(e) => onUpdate(element.id, { instanceDb: e.target.value })}
              className="h-8 font-mono text-xs"
              placeholder="CTU_Instance"
            />
          </div>
        </>
      )}

      {/* Comment */}
      <div className="space-y-1">
        <Label className="text-xs">Comment</Label>
        <Input
          value={element.comment ?? ""}
          onChange={(e) => onUpdate(element.id, { comment: e.target.value })}
          className="h-8 text-xs"
          placeholder="Optional..."
        />
      </div>
    </div>
  );
}
