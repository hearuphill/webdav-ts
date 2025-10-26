const BASE64_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

function toBase64(value: string): string {
  if (typeof globalThis.btoa === "function") {
    return globalThis.btoa(value);
  }

  const bytes = new TextEncoder().encode(value);
  let result = "";

  for (let index = 0; index < bytes.length; index += 3) {
    const byte0 = bytes[index] ?? 0;
    const byte1 = bytes[index + 1] ?? 0;
    const byte2 = bytes[index + 2] ?? 0;

    const combined = (byte0 << 16) | (byte1 << 8) | byte2;
    const remaining = bytes.length - index;
    const padding = remaining >= 3 ? 0 : 3 - remaining;

    for (let offset = 0; offset < 4; offset += 1) {
      if (offset >= 4 - padding) {
        result += "=";
        continue;
      }

      const shift = 18 - offset * 6;
      const alphabetIndex = (combined >> shift) & 63;
      result += BASE64_ALPHABET[alphabetIndex];
    }
  }

  return result;
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function safeParseInteger(value: string): number {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : 0;
}

function decodeSegment(segment: string): string {
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
}

export interface WebDAVClientOptions {
  baseURL: string;
  username?: string;
  password?: string;
  headers?: Record<string, string>;
}

export interface WebDAVStat {
  filename: string;
  basename: string;
  lastmod: string;
  size: number;
  type: "directory" | "file";
  etag?: string;
  mime?: string;
}

export interface WebDAVQuota {
  used: number;
  available: number;
}

export class WebDAVClient {
  private readonly base: URL;
  private readonly basePath: string;
  private readonly authHeader?: string;
  private readonly customHeaders: Record<string, string>;

  constructor(options: WebDAVClientOptions) {
    if (!options.baseURL) {
      throw new Error("baseURL is required");
    }

    const base = new URL(options.baseURL);
    base.hash = "";
    base.search = "";
    if (!base.pathname.endsWith("/")) {
      base.pathname = `${base.pathname}/`;
    }

    this.base = base;
    this.basePath = base.pathname.replace(/\/+$/, "") || "/";
    this.customHeaders = { ...(options.headers ?? {}) };

    if (options.username !== undefined && options.password !== undefined) {
      const credentials = `${options.username}:${options.password}`;
      this.authHeader = `Basic ${toBase64(credentials)}`;
    }
  }

  private resolveURL(path: string): URL {
    if (/^[a-zA-Z][a-zA-Z\d+.-]*:/.test(path)) {
      return new URL(path);
    }

    if (path.startsWith("/")) {
      return new URL(path, this.base.origin);
    }

    return new URL(path, this.base);
  }

  private resolveRequestURL(path: string): URL {
    if (/^[a-zA-Z][a-zA-Z\d+.-]*:/.test(path)) {
      return new URL(path);
    }

    const relative = path.startsWith("/") ? path.slice(1) : path;
    return new URL(relative, this.base);
  }

  private normalizePath(path: string): string {
    try {
      const url = this.resolveURL(path);
      let pathname = url.pathname;

      if (this.basePath !== "/" && (pathname === this.basePath || pathname.startsWith(`${this.basePath}/`))) {
        pathname = pathname.slice(this.basePath.length);
      }

      pathname = pathname.replace(/\/+$/, "");

      if (pathname === "") {
        return "/";
      }

      if (!pathname.startsWith("/")) {
        pathname = `/${pathname}`;
      }

      return pathname;
    } catch {
      const ensured = path.startsWith("/") ? path : `/${path}`;
      const trimmed = ensured.replace(/\/+$/, "");
      return trimmed === "" ? "/" : trimmed;
    }
  }

  private getTagContent(xml: string, tag: string): string {
    const expression = new RegExp(`<[^:>]*:?${tag}[^>]*>([\\s\\S]*?)</[^:>]*:?${tag}>`, "i");
    const match = xml.match(expression);
    return match ? match[1].trim() : "";
  }

  private getAllTagContents(xml: string, tag: string): string[] {
    const expression = new RegExp(`<[^:>]*:?${tag}[^>]*>([\\s\\S]*?)</[^:>]*:?${tag}>`, "gi");
    const matches: string[] = [];
    let match: RegExpExecArray | null;

    while ((match = expression.exec(xml)) !== null) {
      matches.push(match[1].trim());
    }

    return matches;
  }

  private hasTag(xml: string, tag: string): boolean {
    if (!xml) {
      return false;
    }

    const expression = new RegExp(`<[^:>]*:?${tag}[^>]*(?:/?>|>[\\s\\S]*?</[^:>]*:?${tag}>)`, "i");
    return expression.test(xml);
  }

  private parseMultiStatus(xml: string): WebDAVStat[] {
    const responses = this.getAllTagContents(xml, "response");
    const stats: WebDAVStat[] = [];

    for (const response of responses) {
      const href = this.getTagContent(response, "href");
      if (!href) {
        continue;
      }

      const propstats = this.getAllTagContents(response, "propstat");
      let prop = "";

      for (const propstat of propstats) {
        const status = this.getTagContent(propstat, "status");
        if (status === "" || status.includes(" 200 ")) {
          prop = this.getTagContent(propstat, "prop");
          if (prop) {
            break;
          }
        }
      }

      if (!prop) {
        continue;
      }

      const resourceType = this.getTagContent(prop, "resourcetype");
      const isDirectory = this.hasTag(resourceType, "collection");

      const normalizedPath = this.normalizePath(href);
      const segments = normalizedPath.split("/").filter(Boolean);
      const basenameSegment = segments.length === 0 ? "/" : segments[segments.length - 1];
      const basename = decodeSegment(basenameSegment);

      const stat: WebDAVStat = {
        filename: normalizedPath,
        basename,
        lastmod: this.getTagContent(prop, "getlastmodified"),
        size: safeParseInteger(this.getTagContent(prop, "getcontentlength") || "0"),
        type: isDirectory ? "directory" : "file",
      };

      const etag = this.getTagContent(prop, "getetag");
      if (etag) {
        stat.etag = etag;
      }

      const mime = this.getTagContent(prop, "getcontenttype");
      if (mime) {
        stat.mime = mime;
      }

      stats.push(stat);
    }

    return stats;
  }

  private buildHeaders(additional?: Record<string, string>): HeadersInit {
    const headers: Record<string, string> = {
      ...this.customHeaders,
      ...(additional ?? {}),
    };

    if (this.authHeader && headers.Authorization === undefined) {
      headers.Authorization = this.authHeader;
    }

    return headers;
  }

  private async request(
    method: string,
    path: string,
    options: {
      body?: BodyInit | null;
      headers?: Record<string, string>;
    } = {},
  ): Promise<Response> {
    const url = this.resolveRequestURL(path).toString();
    const headers = this.buildHeaders(options.headers);

    return fetch(url, {
      method,
      headers,
      body: options.body ?? null,
    });
  }

  async getDirectoryContents(path: string, depth: number | "infinity" = 1): Promise<WebDAVStat[]> {
    const depthValue =
      typeof depth === "string"
        ? depth.toLowerCase()
        : Number.isFinite(depth)
          ? depth.toString()
          : "infinity";

    const response = await this.request("PROPFIND", path, {
      headers: {
        "Content-Type": "application/xml; charset=utf-8",
        Depth: depthValue,
      },
      body: `<?xml version="1.0" encoding="utf-8" ?>
<d:propfind xmlns:d="DAV:">
  <d:prop>
    <d:resourcetype/>
    <d:getlastmodified/>
    <d:getcontentlength/>
    <d:getetag/>
    <d:getcontenttype/>
  </d:prop>
</d:propfind>`,
    });

    if (!response.ok) {
      throw new Error(`Failed to get directory contents: ${response.status} ${response.statusText}`);
    }

    const xml = await response.text();
    const stats = this.parseMultiStatus(xml);
    const targetPath = this.normalizePath(path);

    return stats.filter((stat) => stat.filename !== targetPath);
  }

  async stat(path: string): Promise<WebDAVStat> {
    const response = await this.request("PROPFIND", path, {
      headers: {
        "Content-Type": "application/xml; charset=utf-8",
        Depth: "0",
      },
      body: `<?xml version="1.0" encoding="utf-8" ?>
<d:propfind xmlns:d="DAV:">
  <d:prop>
    <d:resourcetype/>
    <d:getlastmodified/>
    <d:getcontentlength/>
    <d:getetag/>
    <d:getcontenttype/>
  </d:prop>
</d:propfind>`,
    });

    if (!response.ok) {
      throw new Error(`Failed to stat resource: ${response.status} ${response.statusText}`);
    }

    const xml = await response.text();
    const stats = this.parseMultiStatus(xml);
    const targetPath = this.normalizePath(path);
    const match = stats.find((stat) => stat.filename === targetPath);

    if (match) {
      return match;
    }

    if (stats.length > 0) {
      return stats[0];
    }

    throw new Error(`Resource not found: ${path}`);
  }

  async exists(path: string): Promise<boolean> {
    try {
      await this.stat(path);
      return true;
    } catch (error) {
      if (error instanceof Error) {
        if (/Resource not found/i.test(error.message)) {
          return false;
        }

        if (/Failed to stat resource:\s*404/.test(error.message)) {
          return false;
        }
      }

      throw error;
    }
  }

  async getFileContents(path: string): Promise<ArrayBuffer> {
    const response = await this.request("GET", path);

    if (!response.ok) {
      throw new Error(`Failed to get file contents: ${response.status} ${response.statusText}`);
    }

    return response.arrayBuffer();
  }

  async getFileContentsAsText(path: string, encoding: string = "utf-8"): Promise<string> {
    const buffer = await this.getFileContents(path);
    const decoder = new TextDecoder(encoding);
    return decoder.decode(buffer);
  }

  async putFileContents(
    path: string,
    data: BodyInit | null,
    options: { headers?: Record<string, string> } = {},
  ): Promise<void> {
    const response = await this.request("PUT", path, {
      body: data,
      headers: options.headers,
    });

    if (!response.ok) {
      throw new Error(`Failed to write file: ${response.status} ${response.statusText}`);
    }
  }

  async createDirectory(path: string): Promise<void> {
    const response = await this.request("MKCOL", path);

    if (!response.ok) {
      throw new Error(`Failed to create directory: ${response.status} ${response.statusText}`);
    }
  }

  async deleteFile(path: string): Promise<void> {
    const response = await this.request("DELETE", path);

    if (response.status === 404) {
      return;
    }

    if (!response.ok) {
      throw new Error(`Failed to delete resource: ${response.status} ${response.statusText}`);
    }
  }

  async moveFile(fromPath: string, toPath: string, overwrite: boolean = false): Promise<void> {
    const destination = this.resolveRequestURL(toPath).toString();
    const response = await this.request("MOVE", fromPath, {
      headers: {
        Destination: destination,
        Overwrite: overwrite ? "T" : "F",
      },
    });

    if (!response.ok) {
      throw new Error(`Failed to move resource: ${response.status} ${response.statusText}`);
    }
  }

  async copyFile(fromPath: string, toPath: string, overwrite: boolean = false): Promise<void> {
    const destination = this.resolveRequestURL(toPath).toString();
    const response = await this.request("COPY", fromPath, {
      headers: {
        Destination: destination,
        Overwrite: overwrite ? "T" : "F",
      },
    });

    if (!response.ok) {
      throw new Error(`Failed to copy resource: ${response.status} ${response.statusText}`);
    }
  }

  async getQuota(path: string = "/"): Promise<WebDAVQuota | null> {
    const response = await this.request("PROPFIND", path, {
      headers: {
        "Content-Type": "application/xml; charset=utf-8",
        Depth: "0",
      },
      body: `<?xml version="1.0" encoding="utf-8" ?>
<d:propfind xmlns:d="DAV:">
  <d:prop>
    <d:quota-available-bytes/>
    <d:quota-used-bytes/>
  </d:prop>
</d:propfind>`,
    });

    if (!response.ok) {
      return null;
    }

    const xml = await response.text();
    const propstats = this.getAllTagContents(xml, "propstat");

    for (const propstat of propstats) {
      const status = this.getTagContent(propstat, "status");
      if (status !== "" && !status.includes(" 200 ")) {
        continue;
      }

      const prop = this.getTagContent(propstat, "prop");
      if (!prop) {
        continue;
      }

      const quotaAvailable = this.getTagContent(prop, "quota-available-bytes");
      const quotaUsed = this.getTagContent(prop, "quota-used-bytes");

      if (!quotaAvailable || !quotaUsed) {
        continue;
      }

      return {
        used: safeParseInteger(quotaUsed),
        available: safeParseInteger(quotaAvailable),
      };
    }

    return null;
  }

  async search(
    path: string,
    options: {
      query?: string;
      contentType?: string;
      modifiedAfter?: Date;
      modifiedBefore?: Date;
    } = {},
  ): Promise<WebDAVStat[]> {
    const clauses: string[] = [];

    if (options.query) {
      clauses.push(`<d:like>
        <d:prop><d:displayname/></d:prop>
        <d:literal>%${escapeXml(options.query)}%</d:literal>
      </d:like>`);
    }

    if (options.contentType) {
      clauses.push(`<d:eq>
        <d:prop><d:getcontenttype/></d:prop>
        <d:literal>${escapeXml(options.contentType)}</d:literal>
      </d:eq>`);
    }

    if (options.modifiedAfter) {
      clauses.push(`<d:gt>
        <d:prop><d:getlastmodified/></d:prop>
        <d:literal>${escapeXml(options.modifiedAfter.toISOString())}</d:literal>
      </d:gt>`);
    }

    if (options.modifiedBefore) {
      clauses.push(`<d:lt>
        <d:prop><d:getlastmodified/></d:prop>
        <d:literal>${escapeXml(options.modifiedBefore.toISOString())}</d:literal>
      </d:lt>`);
    }

    const scopePath = this.normalizePath(path);
    const scopeHref = scopePath === "/" ? scopePath : `${scopePath}/`;

    const body = `<?xml version="1.0" encoding="utf-8" ?>
<d:searchrequest xmlns:d="DAV:">
  <d:basicsearch>
    <d:select>
      <d:prop>
        <d:resourcetype/>
        <d:getlastmodified/>
        <d:getcontentlength/>
        <d:getetag/>
        <d:getcontenttype/>
      </d:prop>
    </d:select>
    <d:from>
      <d:scope>
        <d:href>${escapeXml(scopeHref)}</d:href>
        <d:depth>infinity</d:depth>
      </d:scope>
    </d:from>
    ${clauses.length > 0 ? `<d:where>${clauses.join("\n")}</d:where>` : ""}
  </d:basicsearch>
</d:searchrequest>`;

    const response = await this.request("SEARCH", path, {
      headers: {
        "Content-Type": "application/xml; charset=utf-8",
      },
      body,
    });

    if (!response.ok) {
      throw new Error(`Failed to search: ${response.status} ${response.statusText}`);
    }

    const xml = await response.text();
    return this.parseMultiStatus(xml);
  }
}

export function createClient(options: WebDAVClientOptions): WebDAVClient {
  return new WebDAVClient(options);
}
