const https = require("https");
const fs = require("fs");

const TOKEN = process.env.MONDAY_API_TOKEN || fs.readFileSync(".env", "utf8").match(/MONDAY_API_TOKEN=(.*)/)[1].trim();

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
  const ITEM_ID = "2757737273";
  const BOARD_ID = "5092432355";

  // Step 1: Update status to "Awaiting Testing"
  const statusResult = await mondayRequest(
    `mutation ($boardId: ID!, $itemId: ID!, $columnId: String!, $value: String!) {
      change_simple_column_value(board_id: $boardId, item_id: $itemId, column_id: $columnId, value: $value) { id }
    }`,
    {
      boardId: BOARD_ID,
      itemId: ITEM_ID,
      columnId: "status_cdbba809",
      value: "Awaiting Testing",
    }
  );
  console.log("Status updated:", JSON.stringify(statusResult));

  // Step 2: Add comment
  const comment = `Implemented IO tag creation in TIA project:

• Models.cs: Added IoTagDto (name, dataType, logicalAddress, comment) + IoTags field to CreateProjectWithSourcesRequest
• TiaPortalService.cs: Added CreateIoTags() method — creates 'PacForge IO Tags' tag table, adds each entry; NormalizeDataType() maps Bool/Int/Word etc to TIA PascalCase format
• BridgeServer.cs: Passes request.IoTags to CreateProjectWithSources
• use-tia-jobs.ts: createProjectAndImport() now accepts ioTags[] param, serializes to io_tags in request
• process-builder.tsx: Maps project.io_lists to ioTags when calling createProjectAndImport; bridge must be restarted to pick up changes`;

  const commentResult = await mondayRequest(
    `mutation ($itemId: ID!, $body: String!) {
      create_update(item_id: $itemId, body: $body) { id }
    }`,
    {
      itemId: ITEM_ID,
      body: comment,
    }
  );
  console.log("Comment added:", JSON.stringify(commentResult));
}

main().catch((e) => {
  console.error("Failed:", e.message);
  process.exit(1);
});
