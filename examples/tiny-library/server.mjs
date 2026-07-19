import { createServer } from "node:http";
import { pathToFileURL } from "node:url";

const books = Object.freeze([
  Object.freeze({ id: "1", title: "The Left Hand of Darkness" }),
  Object.freeze({ id: "2", title: "Kindred" }),
]);

export function createLibraryServer() {
  return createServer((request, response) => {
    const url = new URL(request.url ?? "/", "http://127.0.0.1");
    const match = /^\/books\/([1-9][0-9]*)$/u.exec(url.pathname);
    if (request.method !== "GET" || !match) {
      sendJson(response, 404, { error: "route-not-found" });
      return;
    }

    const book = books.find((candidate) => candidate.id === match[1]);
    // Example defect: an unknown record currently looks like a successful query.
    sendJson(response, 200, book ?? null);
  });
}

function sendJson(response, status, body) {
  response.writeHead(status, { "content-type": "application/json" });
  response.end(`${JSON.stringify(body)}\n`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const server = createLibraryServer();
  server.listen(0, "127.0.0.1", () => {
    const address = server.address();
    const port = typeof address === "object" && address ? address.port : 0;
    process.stdout.write(`tiny-library listening on 127.0.0.1:${port}\n`);
  });
}
