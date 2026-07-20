import {
  getProfile,
  type LoveProfile,
  noStoreHeaders,
} from "@/app/lib/password-auth";
import { getBucket } from "@/app/lib/private-storage";

const MOODS = new Set(["happy", "sad", "love", "kiss", "calm", "tired"]);
type Visibility = "public" | "private";

type CheckIn = {
  id: string;
  date: string;
  mood: string;
  note: string;
  author: LoveProfile;
  owner: LoveProfile;
  visibility: Visibility;
  createdAt: string;
};

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

function isVisible(metadata: Record<string, string>, profile: LoveProfile) {
  return visibilityOf(metadata) === "public" || asProfile(metadata.owner) === profile;
}

function keyFor(profile: LoveProfile, date: string) {
  return `checkins/${profile}/${date}`;
}

function validDate(value: unknown): value is string {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function unauthorized() {
  return Response.json(
    { error: "需要先进入个人页面。" },
    { status: 401, headers: noStoreHeaders() },
  );
}

function toCheckIn(object: {
  key: string;
  customMetadata?: Record<string, string>;
}): CheckIn | null {
  const metadata = object.customMetadata ?? {};
  const owner = asProfile(metadata.owner);
  if (!owner || !metadata.date || !metadata.mood) {
    return null;
  }

  return {
    id: object.key,
    date: metadata.date,
    mood: metadata.mood,
    note: decodeMetadata(metadata.note),
    author: owner,
    owner,
    visibility: visibilityOf(metadata),
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
      prefix: "checkins/",
      limit: 366,
      include: ["customMetadata"],
    });
    const checkIns = listed.objects
      .filter((object) => isVisible(object.customMetadata ?? {}, profile))
      .map(toCheckIn)
      .filter((checkIn): checkIn is CheckIn => checkIn !== null)
      .sort((a, b) => b.date.localeCompare(a.date));

    return Response.json({ checkIns }, { headers: noStoreHeaders() });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Check-ins unavailable";
    return Response.json(
      { error: message },
      { status: 500, headers: noStoreHeaders() },
    );
  }
}

export async function PUT(request: Request) {
  const profile = await getProfile(request);
  if (!profile) {
    return unauthorized();
  }

  try {
    const body = (await request.json()) as {
      date?: unknown;
      mood?: unknown;
      note?: unknown;
      visibility?: unknown;
    };

    if (!validDate(body.date) || typeof body.mood !== "string" || !MOODS.has(body.mood)) {
      return Response.json(
        { error: "心情或日期格式不正确。" },
        { status: 400, headers: noStoreHeaders() },
      );
    }

    const note = typeof body.note === "string" ? body.note.trim().slice(0, 280) : "";
    const visibility: Visibility = body.visibility === "private" ? "private" : "public";
    const createdAt = new Date().toISOString();
    const checkIn: CheckIn = {
      id: keyFor(profile, body.date),
      date: body.date,
      mood: body.mood,
      note,
      author: profile,
      owner: profile,
      visibility,
      createdAt,
    };

    await getBucket().put(checkIn.id, JSON.stringify(checkIn), {
      httpMetadata: { contentType: "application/json; charset=utf-8" },
      customMetadata: {
        date: checkIn.date,
        mood: checkIn.mood,
        note: encodeMetadata(checkIn.note),
        owner: profile,
        visibility,
        createdAt,
      },
    });

    return Response.json({ checkIn }, { headers: noStoreHeaders() });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Check-in failed";
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

  const date = new URL(request.url).searchParams.get("date");
  if (!validDate(date)) {
    return Response.json(
      { error: "日期格式不正确。" },
      { status: 400, headers: noStoreHeaders() },
    );
  }

  try {
    await getBucket().delete(keyFor(profile, date));
    return new Response(null, { status: 204, headers: noStoreHeaders() });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Check-in unavailable";
    return Response.json(
      { error: message },
      { status: 500, headers: noStoreHeaders() },
    );
  }
}
