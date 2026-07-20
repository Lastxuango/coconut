import {
  changeProfilePassword,
  createProfileCookie,
  getProfile,
  noStoreHeaders,
} from "@/app/lib/password-auth";

function unauthorized() {
  return Response.json(
    { error: "请先进入自己的个人页面。" },
    { status: 401, headers: noStoreHeaders() },
  );
}

export async function PUT(request: Request) {
  const profile = await getProfile(request);
  if (!profile) {
    return unauthorized();
  }

  try {
    const body = (await request.json()) as {
      currentPassword?: unknown;
      nextPassword?: unknown;
    };
    const changed = await changeProfilePassword(
      profile,
      body.currentPassword,
      body.nextPassword,
    );
    if (!changed) {
      return Response.json(
        { error: "当前密码不正确，或新密码长度不符合要求。" },
        { status: 400, headers: noStoreHeaders() },
      );
    }

    const headers = new Headers(noStoreHeaders());
    headers.set("set-cookie", await createProfileCookie(request, profile));
    return Response.json({ changed: true }, { headers });
  } catch {
    return Response.json(
      { error: "暂时无法修改密码，请稍后重试。" },
      { status: 500, headers: noStoreHeaders() },
    );
  }
}
