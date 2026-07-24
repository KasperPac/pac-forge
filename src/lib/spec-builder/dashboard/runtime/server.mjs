import http from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = fileURLToPath(new URL(".", import.meta.url));
const TYPES = { ".html": "text/html", ".js": "application/javascript", ".css": "text/css", ".md": "text/markdown" };
const PORT = process.env.PORT || 8099;

http.createServer(async (req, res) => {
  const name = req.url === "/" ? "index.html" : decodeURIComponent(req.url.slice(1).split("?")[0]);
  try {
    const buf = await readFile(join(here, name));
    res.writeHead(200, { "Content-Type": TYPES[extname(name)] || "application/octet-stream" });
    res.end(buf);
  } catch {
    res.writeHead(404); res.end("not found");
  }
}).listen(PORT, () => console.log(`Dashboard on http://localhost:${PORT}`));
