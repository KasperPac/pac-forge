const https = require("https");

const TOKEN = process.env.MONDAY_API_TOKEN || require("fs").readFileSync(".env", "utf8").match(/MONDAY_API_TOKEN=(.*)/)[1].trim();
const BOARD_ID = "5092432355";

function mondayRequest(query, variables) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify({ query, variables });
    const req = https.request({
      hostname: "api.monday.com",
      path: "/v2",
      method: "POST",
      headers: {
        Authorization: TOKEN,
        "Content-Type": "application/json",
        "API-Version": "2025-10",
        "Content-Length": Buffer.byteLength(data),
      },
    }, (res) => {
      let body = "";
      res.on("data", (d) => (body += d));
      res.on("end", () => {
        const parsed = JSON.parse(body);
        if (parsed.errors) reject(new Error(JSON.stringify(parsed.errors)));
        else resolve(parsed.data);
      });
    });
    req.on("error", reject);
    req.write(data);
    req.end();
  });
}

async function main() {
  // Create parent task
  const improvements = `STAGED PIPELINE OVERHAUL:

1. PM Chat Q&A Flow - AI-driven chat in left panel asks questions (system requirements, devices, IO modules, FB templates). Right column shows accumulated Q&A for reference. PM recommends IO modules + FB templates from library.

2. IO Stage - PM recommendation populates Hardware Config editor. User confirms modules. Auto-generates IO list. Ensures all required sensors/actuators are accounted for.

3. Folder Structure Stage - PM creates/validates TIA Portal folder structure per design profile rules. No code architect needed.

4. FB Generation Stage - PM identifies needed FBs, suggests from FB library. All FBs of same type in one pipeline pass. If no suitable template, user can leave to create one (auto-save state).

5. DB Generation Stage - Instance DBs + Global DBs generated through pipeline.

6. Process FC + OB1 Stage - Links all FBs via Process FC, generates OB1 Main.

KEY FEATURES:
- Toggleable stage gating (review each step or auto-proceed)
- Context accumulation (each stage output feeds into next)
- Auto-save at each stage for resume capability
- Rollback to previous stages
- One artifact type per pipeline pass`;

  const parentResult = await mondayRequest(
    `mutation ($boardId: ID!, $itemName: String!, $colVals: JSON!) {
      create_item(board_id: $boardId, item_name: $itemName, column_values: $colVals) { id name }
    }`,
    {
      boardId: BOARD_ID,
      itemName: "Process Code Overhaul - Staged Multi-Agent Pipeline with PM Q&A",
      colVals: JSON.stringify({
        status_cdbba809: { label: "Planned" },
        text_mm0zxr0q: "Major rework of process code generation. PM-driven Q&A chat replaces single-pass generation with staged pipeline: IO > Folders > FBs > DBs > Process FC. Each stage reviewed independently.",
        text_mm0z53gt: improvements,
      }),
    }
  );

  const parentId = parentResult.create_item.id;
  console.log("Parent task created:", parentId, parentResult.create_item.name);

  // Create subtasks
  const subtasks = [
    "Routing & Sidebar - Pac-ST group with Chat, FB Builder, Process Builder sub-pages",
    "Supabase Schema - Process session tables, stage state persistence, artifact tracking",
    "PM Q&A Chat UI - AI-driven question flow with collapsible side panel for accumulated answers",
    "PM Q&A Prompts - Structured question prompts, IO/FB recommendation logic",
    "IO Stage - Module recommendation populates Hardware Config, auto-generate IO list",
    "Folder Structure Stage - PM validates folder layout per design profile rules",
    "FB Generation Stage - Grouped by device type, FB library suggestions, leave-and-create flow",
    "DB Generation Stage - Instance DBs + Global DBs through pipeline",
    "Process FC + OB1 Stage - Link all FBs via Process FC, generate OB1 Main",
    "Stage Gating Toggle - Toggleable review between stages (auto-proceed or pause)",
    "Auto-save & Rollback - State persistence at each stage, rollback deletes artifacts",
    "Prompt Editor Integration - All process stage prompts editable on Prompts page",
  ];

  for (const name of subtasks) {
    const result = await mondayRequest(
      `mutation ($parentId: ID!, $itemName: String!) {
        create_subitem(parent_item_id: $parentId, item_name: $itemName) { id name }
      }`,
      { parentId, itemName: name }
    );
    console.log("  Subtask:", result.create_subitem.name);
  }

  console.log("\nDone! Parent ID:", parentId);
}

main().catch((e) => {
  console.error("Failed:", e.message);
  process.exit(1);
});
