import {
  getProfile,
  type LoveProfile,
  noStoreHeaders,
} from "@/app/lib/password-auth";
import { getBucket } from "@/app/lib/private-storage";

function asProfile(value: string | undefined): LoveProfile | null {
  return value === "coconut" || value === "xuanmei" ? value : null;
}

function canRead(metadata: Record<string, string>, profile: LoveProfile) {
  return metadata.visibility !== "private" || asProfile(metadata.owner) === profile;
}

function canDelete(metadata: Record<string, string>, profile: LoveProfile) {
  const owner = asProfile(metadata.owner);
  return owner === null || owner === profile;
}

async function readPhoto(id: string) {
  let readError: unknown;

  for (let attempt = 0; attempt < 2; attempt += 1) {
    const object = await getBucket().get(id);
    if (!object) {
      return null;
    }

    try {
      return { object, body: await new Response(object.body).arrayBuffer() };
    } catch (error) {
      readError = error;
    }
  }

  throw readError;
}

function unauthorized() {
  return Response.json(
    { error: "需要先进入个人页面。" },
    { status: 401, headers: noStoreHeaders() },
  );
}

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const profile = await getProfile(request);
  if (!profile) {
    return unauthorized();
  }

  try {
    const { id } = await context.params;
    const photo = await readPhoto(id);
    if (!photo || !canRead(photo.object.customMetadata ?? {}, profile)) {
      return Response.json(
        { error: "Photo not found" },
        { status: 404, headers: noStoreHeaders() },
      );
    }

    // Buffer the capped upload before responding so a client-side cancellation
    // cannot terminate the upstream R2 stream after response headers are sent.
    const headers = new Headers(noStoreHeaders());
    headers.set(
      "content-type",
      photo.object.httpMetadata?.contentType || "application/octet-stream",
    );
    headers.set("content-length", String(photo.body.byteLength));
    headers.set("cache-control", "private, max-age=3600, immutable");
    headers.set("vary", "Cookie");

    return new Response(photo.body, { headers });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Photo unavailable";
    return Response.json(
      { error: message },
      { status: 500, headers: noStoreHeaders() },
    );
  }
}

export async function DELETE(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const profile = await getProfile(request);
  if (!profile) {
    return unauthorized();
  }

  try {
    const { id } = await context.params;
    const bucket = getBucket();
    const object = await bucket.get(id);
    if (!object) {
      return Response.json(
        { error: "Photo not found" },
        { status: 404, headers: noStoreHeaders() },
      );
    }

    if (!canDelete(object.customMetadata ?? {}, profile)) {
      return Response.json(
        { error: "只能删除自己记录的回忆。" },
        { status: 403, headers: noStoreHeaders() },
      );
    }

    await bucket.delete(id);
    return new Response(null, { status: 204, headers: noStoreHeaders() });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Photo unavailable";
    return Response.json(
      { error: message },
      { status: 500, headers: noStoreHeaders() },
    );
  }
}
