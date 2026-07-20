import { del, get, list, put } from "@vercel/blob";

type HttpMetadata = {
  contentType?: string;
};

type PutOptions = {
  httpMetadata?: HttpMetadata;
  customMetadata?: Record<string, string>;
};

type StoredObject = {
  key: string;
  body: ReadableStream<Uint8Array>;
  httpMetadata?: HttpMetadata;
  customMetadata?: Record<string, string>;
};

type StoredObjectMetadata = {
  key: string;
  contentType: string;
  customMetadata: Record<string, string>;
};

type ListOptions = {
  prefix?: string;
  limit?: number;
  include?: string[];
};

const DATA_PREFIX = "love-memory-v1/data/";
const METADATA_PREFIX = "love-memory-v1/metadata/";
const PRIVATE_ACCESS = "private" as const;

function dataPath(key: string) {
  return `${DATA_PREFIX}${key}`;
}

function metadataPath(key: string) {
  return `${METADATA_PREFIX}${key}.json`;
}

function originalKey(pathname: string) {
  return pathname.slice(METADATA_PREFIX.length, -".json".length);
}

function assertStorageConfigured() {
  if (!process.env.BLOB_READ_WRITE_TOKEN && !process.env.VERCEL) {
    throw new Error("Vercel Blob storage is not configured.");
  }
}

async function readMetadata(key: string): Promise<StoredObjectMetadata | null> {
  const result = await get(metadataPath(key), {
    access: PRIVATE_ACCESS,
    useCache: false,
  });
  if (!result || result.statusCode !== 200 || !result.stream) {
    return null;
  }

  const parsed = (await new Response(result.stream).json()) as Partial<StoredObjectMetadata>;
  if (
    parsed.key !== key ||
    typeof parsed.contentType !== "string" ||
    !parsed.customMetadata ||
    typeof parsed.customMetadata !== "object"
  ) {
    throw new Error("Stored metadata is invalid.");
  }

  return {
    key,
    contentType: parsed.contentType,
    customMetadata: parsed.customMetadata as Record<string, string>,
  };
}

async function readObject(key: string): Promise<StoredObject | null> {
  const [result, metadata] = await Promise.all([
    get(dataPath(key), { access: PRIVATE_ACCESS, useCache: false }),
    readMetadata(key),
  ]);

  if (!result || result.statusCode !== 200 || !result.stream || !metadata) {
    return null;
  }

  return {
    key,
    body: result.stream,
    httpMetadata: { contentType: metadata.contentType },
    customMetadata: metadata.customMetadata,
  };
}

async function writeObject(
  key: string,
  body: string | ArrayBuffer | ReadableStream<Uint8Array>,
  options: PutOptions = {},
) {
  const contentType = options.httpMetadata?.contentType || "application/octet-stream";
  const metadata: StoredObjectMetadata = {
    key,
    contentType,
    customMetadata: options.customMetadata ?? {},
  };

  await put(dataPath(key), body, {
    access: PRIVATE_ACCESS,
    addRandomSuffix: false,
    allowOverwrite: true,
    contentType,
  });
  await put(metadataPath(key), JSON.stringify(metadata), {
    access: PRIVATE_ACCESS,
    addRandomSuffix: false,
    allowOverwrite: true,
    contentType: "application/json; charset=utf-8",
  });
}

async function listObjects(options: ListOptions = {}) {
  const prefix = options.prefix ?? "";
  const limit = Math.max(1, Math.min(options.limit ?? 1000, 1000));
  const objects: Array<Pick<StoredObject, "key" | "httpMetadata" | "customMetadata">> = [];
  let cursor: string | undefined;

  do {
    const page = await list({
      prefix: `${METADATA_PREFIX}${prefix}`,
      limit: Math.min(1000, limit - objects.length),
      cursor,
    });

    const metadata = await Promise.all(
      page.blobs
        .filter((blob) => blob.pathname.endsWith(".json"))
        .map((blob) => readMetadata(originalKey(blob.pathname))),
    );
    for (const entry of metadata) {
      if (entry) {
        objects.push({
          key: entry.key,
          httpMetadata: { contentType: entry.contentType },
          customMetadata: entry.customMetadata,
        });
      }
    }

    cursor = page.cursor;
  } while (cursor && objects.length < limit);

  return { objects };
}

async function deleteObject(key: string) {
  await Promise.all([
    del(dataPath(key)),
    del(metadataPath(key)),
  ]);
}

/**
 * R2-compatible surface used by the existing route handlers. Data and its
 * metadata are stored as separate private Vercel Blob objects.
 */
export function getBucket() {
  assertStorageConfigured();
  return {
    get: readObject,
    put: writeObject,
    list: listObjects,
    delete: deleteObject,
  };
}
