import { afterEach, describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { createClient } from "./webdav-client.ts";

const originalFetch = globalThis.fetch;

function toHeaders(init: RequestInit | undefined): Headers {
  return new Headers(init?.headers ?? {});
}

describe("WebDAVClient", () => {
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("parses PROPFIND multi-status responses", async () => {
    const calls: Array<{ input: string; init?: RequestInit }> = [];
    const multistatus = `<?xml version="1.0" encoding="utf-8" ?>
<d:multistatus xmlns:d="DAV:">
  <d:response>
    <d:href>/dav/folder/</d:href>
    <d:propstat>
      <d:status>HTTP/1.1 200 OK</d:status>
      <d:prop>
        <d:resourcetype><d:collection/></d:resourcetype>
        <d:getlastmodified>Tue, 21 May 2024 10:20:30 GMT</d:getlastmodified>
        <d:getcontentlength>0</d:getcontentlength>
      </d:prop>
    </d:propstat>
  </d:response>
  <d:response>
    <d:href>/dav/folder/document.txt</d:href>
    <d:propstat>
      <d:status>HTTP/1.1 200 OK</d:status>
      <d:prop>
        <d:resourcetype />
        <d:getlastmodified>Tue, 21 May 2024 11:20:30 GMT</d:getlastmodified>
        <d:getcontentlength>1234</d:getcontentlength>
        <d:getcontenttype>text/plain</d:getcontenttype>
        <d:getetag>"abc"</d:getetag>
      </d:prop>
    </d:propstat>
  </d:response>
  <d:response>
    <d:href>/dav/folder/photos/</d:href>
    <d:propstat>
      <d:status>HTTP/1.1 200 OK</d:status>
      <d:prop>
        <d:resourcetype><d:collection/></d:resourcetype>
        <d:getlastmodified>Tue, 21 May 2024 12:30:30 GMT</d:getlastmodified>
        <d:getcontentlength>0</d:getcontentlength>
      </d:prop>
    </d:propstat>
  </d:response>
</d:multistatus>`;

    globalThis.fetch = async (input, init) => {
      calls.push({ input: input.toString(), init });
      return new Response(multistatus, { status: 207, statusText: "Multi-Status" });
    };

    const client = createClient({
      baseURL: "https://example.com/dav",
      username: "user",
      password: "pass",
    });

    const contents = await client.getDirectoryContents("/folder/");

    assert.equal(contents.length, 2);

    const file = contents.find((entry) => entry.filename === "/folder/document.txt");
    assert.ok(file);
    assert.equal(file.type, "file");
    assert.equal(file.basename, "document.txt");
    assert.equal(file.mime, "text/plain");
    assert.equal(file.size, 1234);
    assert.equal(file.etag, "\"abc\"");

    const directory = contents.find((entry) => entry.filename === "/folder/photos");
    assert.ok(directory);
    assert.equal(directory.type, "directory");

    assert.equal(calls.length, 1);
    assert.equal(calls[0].input, "https://example.com/dav/folder/");
    const headers = toHeaders(calls[0].init);
    assert.equal(headers.get("Depth"), "1");
    assert.equal(headers.get("Authorization"), "Basic dXNlcjpwYXNz");
  });

  it("returns stat for a single resource", async () => {
    const multistatus = `<?xml version="1.0" encoding="utf-8" ?>
<d:multistatus xmlns:d="DAV:">
  <d:response>
    <d:href>/dav/folder/readme.md</d:href>
    <d:propstat>
      <d:status>HTTP/1.1 200 OK</d:status>
      <d:prop>
        <d:resourcetype />
        <d:getlastmodified>Wed, 22 May 2024 13:45:00 GMT</d:getlastmodified>
        <d:getcontentlength>512</d:getcontentlength>
        <d:getcontenttype>text/markdown</d:getcontenttype>
      </d:prop>
    </d:propstat>
  </d:response>
</d:multistatus>`;

    globalThis.fetch = async () => new Response(multistatus, { status: 207, statusText: "Multi-Status" });

    const client = createClient({ baseURL: "https://example.com/dav/" });
    const stat = await client.stat("folder/readme.md");

    assert.equal(stat.filename, "/folder/readme.md");
    assert.equal(stat.type, "file");
    assert.equal(stat.size, 512);
    assert.equal(stat.mime, "text/markdown");
  });

  it("returns false from exists when the resource is missing", async () => {
    globalThis.fetch = async () => new Response("", { status: 404, statusText: "Not Found" });

    const client = createClient({ baseURL: "https://example.com/dav" });
    const result = await client.exists("missing.txt");

    assert.equal(result, false);
  });

  it("rethrows errors from exists for non-404 responses", async () => {
    globalThis.fetch = async () => new Response("", { status: 500, statusText: "Server Error" });

    const client = createClient({ baseURL: "https://example.com/dav" });

    await assert.rejects(client.exists("broken.txt"), /Failed to stat resource: 500/);
  });

  it("ignores missing resources when deleting", async () => {
    let callCount = 0;
    globalThis.fetch = async () => {
      callCount += 1;
      return new Response("", { status: 404, statusText: "Not Found" });
    };

    const client = createClient({ baseURL: "https://example.com/dav" });
    await client.deleteFile("missing.txt");

    assert.equal(callCount, 1);
  });

  it("sets the destination header when moving resources", async () => {
    let destinationHeader = "";
    let overwriteHeader = "";
    let requestedURL = "";

    globalThis.fetch = async (input, init) => {
      requestedURL = input.toString();
      const headers = toHeaders(init);
      destinationHeader = headers.get("Destination") ?? "";
      overwriteHeader = headers.get("Overwrite") ?? "";
      return new Response("", { status: 201, statusText: "Created" });
    };

    const client = createClient({ baseURL: "https://example.com/dav" });
    await client.moveFile("old.txt", "archive/new.txt", true);

    assert.equal(requestedURL, "https://example.com/dav/old.txt");
    assert.equal(destinationHeader, "https://example.com/dav/archive/new.txt");
    assert.equal(overwriteHeader, "T");
  });
});
