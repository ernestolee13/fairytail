import assert from "node:assert/strict";
import test from "node:test";

import { createLibraryServer } from "./server.mjs";

test("an unknown book is reported as missing", async (context) => {
  const server = createLibraryServer();
  context.after(() => server.close());
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address === "object");

  const response = await fetch(`http://127.0.0.1:${address.port}/books/999`);
  assert.equal(response.status, 404);
  assert.deepEqual(await response.json(), { error: "book-not-found" });
});
