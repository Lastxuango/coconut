import {
  getProfile,
  type LoveProfile,
  noStoreHeaders,
} from "@/app/lib/password-auth";
import { getBucket } from "@/app/lib/private-storage";

const MAX_FILE_SIZE = 8 * 1024 * 1024;
const UPLOAD_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type Visibility = "public" | "private";

type PhotoRecord = {
  id: string;
  title: string;
  message: string;
  date: string;
  url: string;
  source: "uploaded";
  createdAt: string;
  author: string;
  owner: LoveProfile | null;
  visibility: Visibility;
};

function fieldValue(value: FormDataEntryValue | null) {
  return typeof value === "string" ? value.trim() : "";
}

function uploadIdFor(value: FormDataEntryValue | null) {
  const uploadId = fieldValue(value);
  return UPLOAD_ID_PATTERN.test(uploadId) ? uploadId : crypto.randomUUID();
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

function asProfile(value: string | undefined): LoveProfile | null {
  return value === "coconut" || value === "xuanmei" ? value : null;
}

function visibilityOf(metadata: Record<string, string>): Visibility {
  return metadata.visibility === "private" ? "private" : "public";
}

function canRead(
  metadata: Record<string, string>,
  profile: LoveProfile,
) {
  return visibilityOf(metadata) === "public" || asProfile(metadata.owner) === profile;
}

function canDelete(
  metadata: Record<string, string>,
  profile: LoveProfile,
) {
  const owner = asProfile(metadata.owner);
  return owner === null || owner === profile;
}

function authorFor(value: string, profile: LoveProfile) {
  return value === "coconut" || value === "xuanmei" || value === "我们"
    ? value
    : profile;
}

function toPhotoRecord(
  object: {
    key: string;
    httpMetadata?: { contentType?: string };
    customMetadata?: Record<string, string>;
  },
): PhotoRecord {
  const metadata = object.customMetadata ?? {};
  const contentType = object.httpMetadata?.contentType ?? "";
  const hasImage = contentType.startsWith("image/");

  return {
    id: object.key,
    title: decodeMetadata(metadata.title) || "今天的小事",
    message: decodeMetadata(metadata.message),
    date: metadata.date || metadata.createdAt?.slice(0, 10) || "",
    url: hasImage ? `/api/photos/${object.key}` : "",
    source: "uploaded",
    createdAt: metadata.createdAt || "",
    author: decodeMetadata(metadata.author) || "我们",
    owner: asProfile(metadata.owner),
    visibility: visibilityOf(metadata),
  };
}

function unauthorized() {
  return Response.json(
    { error: "需要先进入个人页面。" },
    { status: 401, headers: noStoreHeaders() },
  );
}

export async function GET(request: Request) {
  const profile = await getProfile(request);
  if (!profile) {
    return unauthorized();
  }

  try {
    const listed = await getBucket().list({
      limit: 200,
      include: ["customMetadata", "httpMetadata"],
    });
    const photos = listed.objects
      .filter((object) => !object.key.includes("/"))
      .filter((object) => canRead(object.customMetadata ?? {}, profile))
      .map(toPhotoRecord)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));

    return Response.json({ photos }, { headers: noStoreHeaders() });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Photos unavailable";
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
    const formData = await request.formData();
    const file = formData.get("photo");
    const hasPhoto = file instanceof File && file.size > 0;
    // Reusing the client-generated ID makes a retry overwrite the same R2 object.
    const id = uploadIdFor(formData.get("uploadId"));
    const createdAt = new Date().toISOString();
    const title = fieldValue(formData.get("title")) || "今天的小事";
    const message = fieldValue(formData.get("message"));
    const date = fieldValue(formData.get("date")) || createdAt.slice(0, 10);
    const visibility: Visibility =
      fieldValue(formData.get("visibility")) === "private" ? "private" : "public";
    const author = authorFor(fieldValue(formData.get("author")), profile);
    const bucket = getBucket();

    if (hasPhoto && !file.type.startsWith("image/")) {
      return Response.json({ error: "photo must be an image" }, { status: 400 });
    }

    if (hasPhoto && file.size > MAX_FILE_SIZE) {
      return Response.json({ error: "photo is too large" }, { status: 400 });
    }

    await bucket.put(id, hasPhoto ? await file.arrayBuffer() : "", {
      httpMetadata: {
        contentType: hasPhoto ? file.type : "text/plain; charset=utf-8",
      },
      customMetadata: {
        title: encodeMetadata(title.slice(0, 120)),
        message: encodeMetadata(message.slice(0, 1200)),
        date,
        author: encodeMetadata(author),
        owner: profile,
        visibility,
        originalName: hasPhoto ? encodeMetadata(file.name.slice(0, 160)) : "",
        createdAt,
      },
    });

    const photo: PhotoRecord = {
      id,
      title,
      message,
      date,
      url: hasPhoto ? `/api/photos/${id}` : "",
      source: "uploaded",
      createdAt,
      author,
      owner: profile,
      visibility,
    };

    return Response.json(
      { photo },
      { status: 201, headers: noStoreHeaders() },
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "Upload failed";
    return Response.json(
      { error: message },
      { status: 500, headers: noStoreHeaders() },
    );
  }
}

export { canDelete, canRead, getBucket, unauthorized };
