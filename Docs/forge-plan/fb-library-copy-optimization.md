# Fix: Skip AI generation for exact FB template matches

## Problem

When a device matches an FB template exactly (e.g. "Motor DOL" matches the Motor DOL template), the wizard still sends the template to the AI and asks it to "adapt" it. This wastes tokens, takes time, and risks the AI changing proven code that already compiles.

## Solution

For exact matches, bypass the AI entirely. Copy the template blocks as-is and only generate the instance DB (which is deterministic — no AI needed).

## Changes needed

### 1. `src/hooks/use-forge-device-generate.ts`

In `generateSingle()`, before calling the AI, check if the device has an exact template match:

```typescript
// If exact match with a template that has blocks, skip AI — copy blocks directly
if (device.fb_match_confidence === "exact" && matchedTemplate?.blocks?.length) {
  return copyTemplateAsArtifacts(device, matchedTemplate);
}

// Otherwise, call the AI as before...
```

Add a new helper function `copyTemplateAsArtifacts`:

```typescript
function copyTemplateAsArtifacts(
  device: ForgeDeviceEntry,
  template: FbTemplate,
): ForgeArtifact[] {
  const artifacts: ForgeArtifact[] = [];

  // Copy all template blocks (FB, UDT, FC, etc.) as artifacts
  for (const block of (template.blocks ?? []).sort((a, b) => a.sort_order - b.sort_order)) {
    artifacts.push({
      id: crypto.randomUUID(),
      name: block.block_name,
      type: block.block_type as ForgeArtifact["type"],
      language: "SCL",
      content: block.scl_code,
      approved: false,
      fb_template_id: template.id,
      stage: "device",
      destination_folder:
        block.block_type === "UDT" ? "Types"
        : block.block_type === "DB" ? "Data blocks"
        : "Program blocks/Forge",
      dependencies: [],
      compile_after_import: true,
    });
  }

  // Generate the instance DB deterministically — no AI needed
  // Find the main FB block to reference
  const mainFb = template.blocks?.find(b => b.block_type === "FB");
  if (mainFb) {
    const instDbName = `Inst${device.name.replace(/[^A-Za-z0-9]/g, "")}`;
    const instDbCode = [
      `DATA_BLOCK "${instDbName}"`,
      `{ S7_Optimized_Access := 'TRUE' }`,
      `VERSION : 0.1`,
      `NON_RETAIN`,
      `"${mainFb.block_name}"`,
      `BEGIN`,
      `END_DATA_BLOCK`,
    ].join("\n");

    artifacts.push({
      id: crypto.randomUUID(),
      name: instDbName,
      type: "DB",
      language: "SCL",
      content: instDbCode,
      approved: false,
      fb_template_id: template.id,
      stage: "device",
      destination_folder: "Data blocks",
      dependencies: [mainFb.block_name],
      compile_after_import: true,
    });
  }

  return artifacts;
}
```

### 2. Deduplicate template blocks across multiple devices

If 3 motors all match the same Motor DOL template, the FB and UDT should only be copied ONCE, but 3 instance DBs should be generated.

In `generateAll()`, track which template blocks have already been copied:

```typescript
const copiedTemplateBlockNames = new Set<string>();

for (const device of devices) {
  if (device.fb_match_confidence === "exact" && matchedTemplate?.blocks?.length) {
    const artifacts = copyTemplateAsArtifacts(device, matchedTemplate);
    
    // Only add FB/UDT blocks if not already copied from same template
    for (const artifact of artifacts) {
      if (artifact.type === "DB") {
        // Instance DBs are always unique per device — always add
        allArtifacts.push(artifact);
      } else if (!copiedTemplateBlockNames.has(artifact.name)) {
        // FB/UDT/FC blocks — only add once per template
        allArtifacts.push(artifact);
        copiedTemplateBlockNames.add(artifact.name);
      }
    }
  } else {
    // No exact match — use AI generation as before
    const artifacts = await generateSingle(device, session, profile, fbTemplates, patterns);
    allArtifacts.push(...artifacts);
  }
}
```

### 3. Update progress reporting

When copying a template (no AI call), the progress should still update but indicate it was a copy:

```typescript
setProgress({
  current: i + 1,
  total: devices.length + 1,
  currentDevice: `${device.name} (from template)`,
});
```

### 4. Visual indicator in the device code step

In `src/components/forge/steps/forge-device-code.tsx`, show which artifacts came from templates vs AI:

In the artifact list, if `artifact.fb_template_id` is set, show a small badge:
```tsx
{a.fb_template_id && (
  <Badge variant="outline" className="font-mono text-[9px] border-green-600/40 text-green-500">
    library
  </Badge>
)}
```

This tells the engineer "this came straight from your library, not AI generated."

### 5. For probable matches — still use AI, but with full template context

When the match confidence is "probable", keep using the AI but inject ALL template blocks (not just the first):

In `buildDeviceSclPrompt()`, change the template section:

```typescript
const templateSection = fbTemplate?.blocks?.length
  ? `## FB Library Template (${fbTemplate.name})
Use this existing template as the base. Adapt only what's necessary for this device's IO signals.
Do NOT rename blocks or restructure the code — preserve the template structure.

${fbTemplate.blocks.sort((a, b) => a.sort_order - b.sort_order).map(b => 
  `### ${b.block_type}: ${b.block_name}\n\`\`\`scl\n${b.scl_code}\n\`\`\``
).join("\n\n")}`
  : `## FB Library Template\nNo matching template found. Generate a complete FB from scratch following the platform rules.`;
```

This injects ALL blocks from the template (FB + UDTs + any supporting blocks), not just the first.

### 6. Summary of the optimization

| Match confidence | What happens | AI tokens used |
|---|---|---|
| exact | Copy template blocks + generate instance DB deterministically | ZERO |
| probable | AI adapts template (all blocks injected as context) | Normal |
| none | AI generates from scratch | Normal |

This should significantly reduce generation time for projects that use standard device types from the library.

Commit with: "forge-perf: skip AI for exact FB template matches — copy from library"
