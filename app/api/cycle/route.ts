import { env } from "cloudflare:workers";
import { getProfile, noStoreHeaders } from "@/app/lib/password-auth";

const CYCLE_KEY = "periods/coconut/cycles.json";

type Cycle = {
  id: string;
  startDate: string;
  endDate: string | null;
  createdAt: string;
};

function getBucket() {
  const bucket = env.PHOTOS;
  if (!bucket) {
    throw new Error("Private storage is not configured.");
  }

  return bucket;
}

function validDate(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return false;
  }

  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.valueOf()) && parsed.toISOString().slice(0, 10) === value;
}

function isCycle(value: unknown): value is Cycle {
  if (!value || typeof value !== "object") {
    return false;
  }

  const cycle = value as Partial<Cycle>;
  return (
    typeof cycle.id === "string" &&
    validDate(cycle.startDate) &&
    (cycle.endDate === null || validDate(cycle.endDate)) &&
    typeof cycle.createdAt === "string"
  );
}

async function readCycles() {
  const object = await getBucket().get(CYCLE_KEY);
  if (!object) {
    return [] as Cycle[];
  }

  const parsed = await new Response(object.body).json();
  if (!Array.isArray(parsed)) {
    throw new Error("Stored cycle data is invalid.");
  }

  return parsed.filter(isCycle).sort((left, right) => right.startDate.localeCompare(left.startDate));
}

async function saveCycles(cycles: Cycle[]) {
  await getBucket().put(CYCLE_KEY, JSON.stringify(cycles), {
    httpMetadata: { contentType: "application/json; charset=utf-8" },
  });
}

async function coconutProfile(request: Request) {
  const profile = await getProfile(request);
  return profile === "coconut";
}

function unavailable() {
  return Response.json(
    { error: "Not found" },
    { status: 404, headers: noStoreHeaders() },
  );
}

export async function GET(request: Request) {
  if (!(await coconutProfile(request))) {
    return unavailable();
  }

  try {
    return Response.json({ cycles: await readCycles() }, { headers: noStoreHeaders() });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Cycle unavailable";
    return Response.json(
      { error: message },
      { status: 500, headers: noStoreHeaders() },
    );
  }
}

export async function POST(request: Request) {
  if (!(await coconutProfile(request))) {
    return unavailable();
  }

  try {
    const body = (await request.json()) as { startDate?: unknown; endDate?: unknown };
    const endDate = body.endDate === "" ? null : body.endDate;
    if (
      !validDate(body.startDate) ||
      !(endDate === null || validDate(endDate)) ||
      (typeof endDate === "string" && endDate < body.startDate)
    ) {
      return Response.json(
        { error: "请填写正确的开始和结束日期。" },
        { status: 400, headers: noStoreHeaders() },
      );
    }

    const cycle: Cycle = {
      id: crypto.randomUUID(),
      startDate: body.startDate,
      endDate,
      createdAt: new Date().toISOString(),
    };
    const cycles = await readCycles();
    await saveCycles([cycle, ...cycles]);
    return Response.json({ cycle }, { status: 201, headers: noStoreHeaders() });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Cycle failed";
    return Response.json(
      { error: message },
      { status: 500, headers: noStoreHeaders() },
    );
  }
}

export async function PATCH(request: Request) {
  if (!(await coconutProfile(request))) {
    return unavailable();
  }

  try {
    const body = (await request.json()) as { id?: unknown; endDate?: unknown };
    const endDate = body.endDate === "" ? null : body.endDate;
    if (
      typeof body.id !== "string" ||
      !(endDate === null || validDate(endDate))
    ) {
      return Response.json(
        { error: "日期或记录标识不正确。" },
        { status: 400, headers: noStoreHeaders() },
      );
    }

    const cycles = await readCycles();
    const current = cycles.find((cycle) => cycle.id === body.id);
    if (!current) {
      return unavailable();
    }
    if (typeof endDate === "string" && endDate < current.startDate) {
      return Response.json(
        { error: "结束日期不能早于开始日期。" },
        { status: 400, headers: noStoreHeaders() },
      );
    }

    const updated = { ...current, endDate };
    await saveCycles(cycles.map((cycle) => (cycle.id === updated.id ? updated : cycle)));
    return Response.json({ cycle: updated }, { headers: noStoreHeaders() });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Cycle unavailable";
    return Response.json(
      { error: message },
      { status: 500, headers: noStoreHeaders() },
    );
  }
}

export async function DELETE(request: Request) {
  if (!(await coconutProfile(request))) {
    return unavailable();
  }

  const id = new URL(request.url).searchParams.get("id");
  if (!id) {
    return Response.json(
      { error: "记录标识不正确。" },
      { status: 400, headers: noStoreHeaders() },
    );
  }

  try {
    const cycles = await readCycles();
    await saveCycles(cycles.filter((cycle) => cycle.id !== id));
    return new Response(null, { status: 204, headers: noStoreHeaders() });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Cycle unavailable";
    return Response.json(
      { error: message },
      { status: 500, headers: noStoreHeaders() },
    );
  }
}
