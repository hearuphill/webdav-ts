# WebDAV Client

A lightweight WebDAV client for Node.js and browsers that supports the primary WebDAV operations (without lock support).

## Features

- ✅ Works in both Node.js and browsers
- ✅ No external dependencies (uses native `fetch` API)
- ✅ TypeScript with full type definitions
- ✅ Supports all primary WebDAV operations:
  - PROPFIND (directory listings and file stats)
  - GET (read files)
  - PUT (write files)
  - MKCOL (create directories)
  - DELETE (delete files/directories)
  - MOVE (move/rename resources)
  - COPY (copy resources)
  - SEARCH (search resources, if supported by server)
  - Quota information
- ❌ No LOCK/UNLOCK support

## Installation

```bash
npm install
```

## Usage

### Basic Example

```typescript
import { createClient } from "./src/webdav-client.ts";

const client = createClient({
  baseURL: "https://example.com/remote.php/dav/files/username/",
  username: "username",
  password: "password",
});

const files = await client.getDirectoryContents("/");
console.log(files);
```

### API Reference

#### `createClient(options)`

Creates a new WebDAV client instance.

**Options:**
- `baseURL` (string, required): The base URL of the WebDAV server
- `username` (string, optional): Username for basic authentication
- `password` (string, optional): Password for basic authentication
- `headers` (Record<string, string>, optional): Custom headers to include in all requests

**Example:**
```typescript
const client = createClient({
  baseURL: "https://example.com/dav",
  username: "user",
  password: "pass",
  headers: {
    "User-Agent": "MyApp/1.0",
  },
});
```

#### `getDirectoryContents(path, depth?)`

Get the contents of a directory.

**Parameters:**
- `path` (string): Path to the directory
- `depth` (number | "infinity", optional): Depth of the listing (default: 1)

**Returns:** `Promise<WebDAVStat[]>`

**Example:**
```typescript
const contents = await client.getDirectoryContents("/documents");
for (const item of contents) {
  console.log(`${item.basename} (${item.type})`);
}
```

#### `stat(path)`

Get information about a single resource.

**Parameters:**
- `path` (string): Path to the resource

**Returns:** `Promise<WebDAVStat>`

**Example:**
```typescript
const stat = await client.stat("/documents/report.pdf");
console.log(`Size: ${stat.size} bytes`);
console.log(`Last modified: ${stat.lastmod}`);
console.log(`Type: ${stat.type}`);
```

#### `exists(path)`

Check if a resource exists.

**Parameters:**
- `path` (string): Path to the resource

**Returns:** `Promise<boolean>`

**Example:**
```typescript
if (await client.exists("/documents/report.pdf")) {
  console.log("File exists!");
}
```

#### `getFileContents(path)`

Get the contents of a file as an ArrayBuffer.

**Parameters:**
- `path` (string): Path to the file

**Returns:** `Promise<ArrayBuffer>`

**Example:**
```typescript
const buffer = await client.getFileContents("/documents/report.pdf");
```

#### `getFileContentsAsText(path, encoding?)`

Get the contents of a file as text.

**Parameters:**
- `path` (string): Path to the file
- `encoding` (string, optional): Text encoding (default: "utf-8")

**Returns:** `Promise<string>`

**Example:**
```typescript
const text = await client.getFileContentsAsText("/documents/notes.txt");
console.log(text);
```

#### `putFileContents(path, data, options?)`

Write data to a file.

**Parameters:**
- `path` (string): Path to the file
- `data` (BodyInit | null): Data to write (string, ArrayBuffer, Blob, etc.)
- `options` (object, optional): Additional options
  - `headers` (Record<string, string>, optional): Custom headers

**Returns:** `Promise<void>`

**Example:**
```typescript
await client.putFileContents("/documents/notes.txt", "Hello, World!");

const encoder = new TextEncoder();
await client.putFileContents("/documents/data.bin", encoder.encode("binary data"));
```

#### `createDirectory(path)`

Create a new directory.

**Parameters:**
- `path` (string): Path to the directory to create

**Returns:** `Promise<void>`

**Example:**
```typescript
await client.createDirectory("/documents/archive");
```

#### `deleteFile(path)`

Delete a file or directory.

**Parameters:**
- `path` (string): Path to the resource to delete

**Returns:** `Promise<void>`

**Example:**
```typescript
await client.deleteFile("/documents/old-report.pdf");
```

#### `moveFile(fromPath, toPath, overwrite?)`

Move or rename a resource.

**Parameters:**
- `fromPath` (string): Source path
- `toPath` (string): Destination path
- `overwrite` (boolean, optional): Whether to overwrite existing resources (default: false)

**Returns:** `Promise<void>`

**Example:**
```typescript
await client.moveFile("/documents/report.pdf", "/archive/report-2024.pdf");
```

#### `copyFile(fromPath, toPath, overwrite?)`

Copy a resource.

**Parameters:**
- `fromPath` (string): Source path
- `toPath` (string): Destination path
- `overwrite` (boolean, optional): Whether to overwrite existing resources (default: false)

**Returns:** `Promise<void>`

**Example:**
```typescript
await client.copyFile("/documents/template.txt", "/documents/new-doc.txt");
```

#### `getQuota(path?)`

Get quota information for a path.

**Parameters:**
- `path` (string, optional): Path to check quota for (default: "/")

**Returns:** `Promise<WebDAVQuota | null>`

**Example:**
```typescript
const quota = await client.getQuota();
if (quota) {
  console.log(`Used: ${quota.used} bytes`);
  console.log(`Available: ${quota.available} bytes`);
}
```

#### `search(path, options?)`

Search for resources (if supported by the server).

**Parameters:**
- `path` (string): Path to search within
- `options` (object, optional): Search criteria
  - `query` (string, optional): Text query
  - `contentType` (string, optional): Filter by content type
  - `modifiedAfter` (Date, optional): Filter by modification date
  - `modifiedBefore` (Date, optional): Filter by modification date

**Returns:** `Promise<WebDAVStat[]>`

**Example:**
```typescript
const results = await client.search("/documents", {
  query: "report",
  contentType: "text/plain",
  modifiedAfter: new Date("2024-01-01"),
});
```

### Types

#### `WebDAVStat`

```typescript
interface WebDAVStat {
  filename: string;      // Full path to the resource
  basename: string;      // Base name of the resource
  lastmod: string;       // Last modified date
  size: number;          // Size in bytes
  type: "directory" | "file";
  etag?: string;         // ETag (if available)
  mime?: string;         // MIME type (if available)
}
```

#### `WebDAVQuota`

```typescript
interface WebDAVQuota {
  used: number;          // Used space in bytes
  available: number;     // Available space in bytes
}
```

## Testing

```bash
npm test
```

## Browser Compatibility

This library uses modern Web APIs that are available in both Node.js (v18+) and modern browsers:

- `fetch` API
- `URL` API
- `TextEncoder` / `TextDecoder`
- `Headers` API

For browser usage, no build process is required. Simply import the module directly:

```html
<script type="module">
  import { createClient } from "./src/webdav-client.ts";
  
  const client = createClient({
    baseURL: "https://example.com/dav",
    username: "user",
    password: "pass",
  });
  
  // Use the client...
</script>
```

Note: For production browser usage, you'll want to use a bundler like Vite, esbuild, or webpack to optimize the code.

## License

MIT
