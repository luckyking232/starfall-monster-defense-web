import { createServer } from "node:http"
import { readFile } from "node:fs/promises"
import { extname } from "node:path"

const origin = "http://127.0.0.1:4175"
const prefix = "/preview/"
const dist = new URL("../dist/", import.meta.url)
const types = {
  ".css": "text/css",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript",
  ".json": "application/json",
  ".svg": "image/svg+xml",
  ".txt": "text/plain; charset=utf-8",
}

createServer(async (request, response) => {
  const path = new URL(request.url ?? "/", origin).pathname
  const relative = path.slice(prefix.length) || "index.html"
  if (!path.startsWith(prefix) || !/^[\w./-]+$/.test(relative) ||
      relative.split("/").some(part => part === "." || part === "..")) {
    response.writeHead(404).end()
    return
  }
  try {
    const bytes = await readFile(new URL(relative, dist))
    response.writeHead(200, {
      "Content-Type": types[extname(relative)] ?? "application/octet-stream",
      "Cache-Control": "no-store",
    }).end(bytes)
  } catch {
    response.writeHead(404).end()
  }
}).listen(4175, "127.0.0.1")
