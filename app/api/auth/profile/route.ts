import {
  clearProfileCookie,
  createProfileCookie,
  getProfile,
  isAuthenticated,
  noStoreHeaders,
  verifyProfilePassword,
} from "@/app/lib/password-auth";

function unauthorized() {
  return Response.json(
    { error: "请先输入共同密码。" },
    { status: 401, headers: noStoreHeaders() },
  );
}

export async function GET(request: Request) {
  try {
    if (!(await isAuthenticated(request))) {
      return Response.json(
        { authenticated: false, profile: null },
        { headers: noStoreHeaders() },
      );
    }

    return Response.json(
      { authenticated: true, profile: await getProfile(request) },
      { headers: noStoreHeaders() },
    );
  } catch {
    return Response.json(
      { error: "暂时无法确认身份。" },
      { status: 500, headers: noStoreHeaders() },
    );
  }
}

export async function POST(request: Request) {
  try {
    if (!(await isAuthenticated(request))) {
      return unauthorized();
    }

    const body = (await request.json()) as { password?: unknown };
    const profile = await verifyProfilePassword(body.password);
    if (!profile) {
      return Response.json(
        { error: "第二道密码不正确，请再试一次。" },
        { status: 401, headers: noStoreHeaders() },
      );
    }

    const headers = new Headers(noStoreHeaders());
    headers.set("set-cookie", await createProfileCookie(request, profile));
    return Response.json({ profile }, { headers });
  } catch {
    return Response.json(
      { error: "暂时无法进入个人页面，请稍后重试。" },
      { status: 500, headers: noStoreHeaders() },
    );
  }
}

export function DELETE(request: Request) {
  const headers = new Headers(noStoreHeaders());
  headers.set("set-cookie", clearProfileCookie(request));
  return Response.json({ profile: null }, { headers });
}
