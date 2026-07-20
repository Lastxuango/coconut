import { env } from "cloudflare:workers";
import { getProfile, noStoreHeaders } from "@/app/lib/password-auth";

type Memo = {
  id: string;
  title: string;
  content: string;
  createdAt: string;
};

function getBucket() {
  const bucket = env.PHOTOS;
  if (!bucket) {
    throw new Error("Private storage is not configured.");
  }

  return bucket;
}

function encodeMetadata(value: string) {
  return encodeURIComponent(value);
}

function decodeMetadata(value: string | undefined) {
  if (!value) {
    return "";
  }

  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function keyFor(profile: string, id: string) {
  return `memos/${profile}/${id}`;
}

function isMemoId(value: string | null): value is string {
  return typeof value === "string" && /^[a-f0-9-]{36}$/i.test(value);
}

function unauthorized() {
  return Response.json(
    { error: "请先进入自己的个人页面。" },
    { status: 401, headers: noStoreHeaders() },
  );
}

function toMemo(object: {
  key: string;
  customMetadata?: Record<string, string>;
}): Memo | null {
  const metadata = object.customMetadata ?? {};
  const id = object.key.split("/").at(-1);
  if (!id || !isMemoId(id)) {
    return null;
  }

  return {
    id,
    title: decodeMetadata(metadata.title),
    content: decodeMetadata(metadata.content),
    createdAt: metadata.createdAt || "",
  };
}

export async function GET(request: Request) {
  const profile = await getProfile(request);
  if (!profile) {
    return unauthorized();
  }

  try {
    const listed = await getBucket().list({
      prefix: `memos/${profile}/`,
      limit: 200,
      include: ["customMetadata"],
    });
    const memos = listed.objects
      .map(toMemo)
      .filter((memo): memo is Memo => memo !== null)
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt));

    return Response.json({ memos }, { headers: noStoreHeaders() });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Memos unavailable";
    return Response.json(
      { error: message },
      { status: 500, headers: noStoreHeaders() },
    );
  }
}

export async function POST(request: Request) {
  const profile = await getProfile(request);
  if (!profile) {
    return unauthorized();
  }

  try {
    const body = (await request.json()) as { title?: unknown; content?: unknown };
    const title = typeof body.title === "string" ? body.title.trim().slice(0, 80) : "";
    const content = typeof body.content === "string" ? body.content.trim().slice(0, 600) : "";
    if (!title && !content) {
      return Response.json(
        { error: "先写下一句备忘再保存吧。" },
        { status: 400, headers: noStoreHeaders() },
      );
    }

    const memo: Memo = {
      id: crypto.randomUUID(),
      title,
      content,
      createdAt: new Date().toISOString(),
    };
    await getBucket().put(keyFor(profile, memo.id), JSON.stringify(memo), {
      httpMetadata: { contentType: "application/json; charset=utf-8" },
      customMetadata: {
        title: encodeMetadata(memo.title),
        content: encodeMetadata(memo.content),
        createdAt: memo.createdAt,
      },
    });

    return Response.json({ memo }, { status: 201, headers: noStoreHeaders() });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Memo failed";
    return Response.json(
      { error: message },
      { status: 500, headers: noStoreHeaders() },
    );
  }
}

export async function DELETE(request: Request) {
  const profile = await getProfile(request);
  if (!profile) {
    return unauthorized();
  }

  const id = new URL(request.url).searchParams.get("id");
  if (!isMemoId(id)) {
    return Response.json(
      { error: "备忘录标识不正确。" },
      { status: 400, headers: noStoreHeaders() },
    );
  }

  try {
    await getBucket().delete(keyFor(profile, id));
    return new Response(null, { status: 204, headers: noStoreHeaders() });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Memo unavailable";
    return Response.json(
      { error: message },
      { status: 500, headers: noStoreHeaders() },
    );
  }
}
