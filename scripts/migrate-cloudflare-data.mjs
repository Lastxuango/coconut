import { put } from "@vercel/blob";

const DATA_PREFIX = "love-memory-v1/data/";
const METADATA_PREFIX = "love-memory-v1/metadata/";
const PRIVATE_ACCESS = "private";

function required(name) {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

const baseUrl = (process.env.LEGACY_BASE_URL || "https://coconutxuanmei.icu").replace(/\/$/, "");
const masterPassword = required("LEGACY_MASTER_PASSWORD");
const profilePasswords = {
  coconut: required("LEGACY_COCONUT_PASSWORD"),
  xuanmei: required("LEGACY_XUANMEI_PASSWORD"),
};

function dataPath(key) {
  return `${DATA_PREFIX}${key}`;
}

function metadataPath(key) {
  return `${METADATA_PREFIX}${key}.json`;
}

function encodeMetadata(value) {
  return encodeURIComponent(value || "");
}

function cookieValues(headers) {
  if (typeof headers.getSetCookie === "function") {
    return headers.getSetCookie();
  }
  const value = headers.get("set-cookie");
  return value ? [value] : [];
}

function createClient() {
  const cookies = new Map();

  return {
    async request(path, init = {}) {
      const headers = new Headers(init.headers);
      if (cookies.size > 0) {
        headers.set("cookie", [...cookies].map(([key, value]) => `${key}=${value}`).join("; "));
      }

      const response = await fetch(new URL(path, baseUrl), { ...init, headers });
      for (const setCookie of cookieValues(response.headers)) {
        const [pair] = setCookie.split(";", 1);
        const separator = pair.indexOf("=");
        if (separator > 0) {
          cookies.set(pair.slice(0, separator), pair.slice(separator + 1));
        }
      }
      return response;
    },
  };
}

async function responseJson(response, context) {
  if (!response.ok) {
    throw new Error(`${context} failed (${response.status}): ${await response.text()}`);
  }
  return response.json();
}

async function login(profile) {
  const client = createClient();
  await responseJson(
    await client.request("/api/auth/session", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ password: masterPassword }),
    }),
    "Master login",
  );
  await responseJson(
    await client.request("/api/auth/profile", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ password: profilePasswords[profile] }),
    }),
    `${profile} profile login`,
  );
  return client;
}

async function writeObject(key, body, contentType, customMetadata = {}) {
  await put(dataPath(key), body, {
    access: PRIVATE_ACCESS,
    addRandomSuffix: false,
    allowOverwrite: true,
    contentType,
  });
  await put(
    metadataPath(key),
    JSON.stringify({ key, contentType, customMetadata }),
    {
      access: PRIVATE_ACCESS,
      addRandomSuffix: false,
      allowOverwrite: true,
      contentType: "application/json; charset=utf-8",
    },
  );
}

async function migratePhotos(client) {
  const { photos } = await responseJson(await client.request("/api/photos"), "Photo export");
  for (const photo of photos) {
    let body = "";
    let contentType = "text/plain; charset=utf-8";
    if (photo.url) {
      const response = await client.request(photo.url);
      if (!response.ok) {
        throw new Error(`Photo ${photo.id} download failed (${response.status}).`);
      }
      body = await response.arrayBuffer();
      contentType = response.headers.get("content-type") || "application/octet-stream";
    }

    await writeObject(photo.id, body, contentType, {
      title: encodeMetadata(photo.title),
      message: encodeMetadata(photo.message),
      date: photo.date,
      author: encodeMetadata(photo.author),
      owner: photo.owner || "",
      visibility: photo.visibility === "private" ? "private" : "public",
      originalName: "",
      createdAt: photo.createdAt,
    });
  }
  return photos.length;
}

async function migrateCheckIns(client) {
  const { checkIns } = await responseJson(await client.request("/api/check-ins"), "Check-in export");
  for (const checkIn of checkIns) {
    await writeObject(checkIn.id, JSON.stringify(checkIn), "application/json; charset=utf-8", {
      date: checkIn.date,
      mood: checkIn.mood,
      note: encodeMetadata(checkIn.note),
      owner: checkIn.owner,
      visibility: checkIn.visibility === "private" ? "private" : "public",
      createdAt: checkIn.createdAt,
    });
  }
  return checkIns.length;
}

async function migrateMemos(client, profile) {
  const { memos } = await responseJson(await client.request("/api/memos"), `${profile} memo export`);
  for (const memo of memos) {
    await writeObject(`memos/${profile}/${memo.id}`, JSON.stringify(memo), "application/json; charset=utf-8", {
      title: encodeMetadata(memo.title),
      content: encodeMetadata(memo.content),
      createdAt: memo.createdAt,
    });
  }
  return memos.length;
}

async function migrateCycles(coconutClient) {
  const { cycles } = await responseJson(await coconutClient.request("/api/cycle"), "Cycle export");
  await writeObject(
    "periods/coconut/cycles.json",
    JSON.stringify(cycles),
    "application/json; charset=utf-8",
  );
  return cycles.length;
}

async function main() {
  required("BLOB_READ_WRITE_TOKEN");
  const coconut = await login("coconut");
  const xuanmei = await login("xuanmei");

  const [coconutPhotos, xuanmeiPhotos, coconutCheckIns, xuanmeiCheckIns, coconutMemos, xuanmeiMemos, cycles] = await Promise.all([
    migratePhotos(coconut),
    migratePhotos(xuanmei),
    migrateCheckIns(coconut),
    migrateCheckIns(xuanmei),
    migrateMemos(coconut, "coconut"),
    migrateMemos(xuanmei, "xuanmei"),
    migrateCycles(coconut),
  ]);

  console.log(JSON.stringify({
    migrated: {
      visiblePhotos: coconutPhotos + xuanmeiPhotos,
      visibleCheckIns: coconutCheckIns + xuanmeiCheckIns,
      coconutMemos,
      xuanmeiMemos,
      cycles,
    },
  }, null, 2));
}

main().catch(async (error) => {
  console.error(error);
  process.exitCode = 1;
});
