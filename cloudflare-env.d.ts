interface Fetcher {
  fetch(request: Request): Promise<Response>;
}

interface D1Database {
  prepare(query: string): unknown;
  batch(statements: unknown[]): Promise<unknown[]>;
}

interface R2ObjectBody {
  body: ReadableStream;
  key?: string;
  httpMetadata?: {
    contentType?: string;
  };
  customMetadata?: Record<string, string>;
}

interface R2Object {
  key: string;
  httpMetadata?: {
    contentType?: string;
  };
  customMetadata?: Record<string, string>;
}

interface R2Objects {
  objects: R2Object[];
}

interface R2Bucket {
  get(key: string): Promise<R2ObjectBody | null>;
  list(options?: {
    limit?: number;
    prefix?: string;
    include?: Array<"customMetadata" | "httpMetadata">;
  }): Promise<R2Objects>;
  put(
    key: string,
    value: ArrayBuffer | ArrayBufferView | ReadableStream | string | Blob,
    options?: {
      httpMetadata?: {
        contentType?: string;
      };
      customMetadata?: Record<string, string>;
    },
  ): Promise<unknown>;
  delete(key: string): Promise<void>;
}

declare module "cloudflare:workers" {
  export const env: {
    DB?: D1Database;
    PHOTOS?: R2Bucket;
    MEMORY_PASSWORD?: string;
    MEMORY_SESSION_SECRET?: string;
    COCONUT_PASSWORD?: string;
    XUANMEI_PASSWORD?: string;
  };
}
