import {
  clearProfileCookie,
  clearSessionCookie,
  createSessionCookie,
  isAuthenticated,
  noStoreHeaders,
  verifyPassword,
} from "@/app/lib/password-auth";

export async function GET(request: Request) {
  try {
    return Response.json(
      { authenticated: await isAuthenticated(request) },
      { headers: noStoreHeaders() },
    );
  } catch {
    return Response.json(
      { error: "Password protection is unavailable." },
      { status: 500, headers: noStoreHeaders() },
    );
  }
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as { password?: unknown };
    if (!(await verifyPassword(body.password))) {
      return Response.json(
        { error: "密码不正确，请再试一次。" },
        { status: 401, headers: noStoreHeaders() },
      );
    }

    const headers = new Headers(noStoreHeaders());
    headers.set("set-cookie", await createSessionCookie(request));
    return Response.json({ authenticated: true }, { headers });
  } catch {
    return Response.json(
      { error: "暂时无法登录，请稍后重试。" },
      { status: 500, headers: noStoreHeaders() },
    );
  }
}

export function DELETE(request: Request) {
  const headers = new Headers(noStoreHeaders());
  headers.append("set-cookie", clearSessionCookie(request));
  headers.append("set-cookie", clearProfileCookie(request));
  return Response.json({ authenticated: false }, { headers });
}
