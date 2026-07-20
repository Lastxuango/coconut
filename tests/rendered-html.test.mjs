import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("defines a personal couple memory experience", async () => {
  const [component, layout] = await Promise.all([
    readFile(new URL("../app/MemoryKeeper.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/layout.tsx", import.meta.url), "utf8"),
  ]);

  assert.match(layout, /title:/);
  assert.match(component, /coconut × xuanmei/);
  assert.match(component, /心情日历/);
  assert.match(component, /作者/);
  assert.match(component, /visibility/);
  assert.match(component, /accept="image\/\*"/);
  assert.match(component, /api\/check-ins/);
});

test("stores memories in private Vercel Blob storage", async () => {
  const [uploadRoute, photoRoute, storage, nextConfig] = await Promise.all([
    readFile(new URL("../app/api/photos/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/photos/[id]/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/lib/private-storage.ts", import.meta.url), "utf8"),
    readFile(new URL("../next.config.ts", import.meta.url), "utf8"),
  ]);

  assert.match(storage, /@vercel\/blob/);
  assert.match(storage, /access: PRIVATE_ACCESS/);
  assert.match(storage, /METADATA_PREFIX/);
  assert.match(storage, /allowOverwrite: true/);
  assert.match(uploadRoute, /formData\.get\("author"\)/);
  assert.match(uploadRoute, /visibility/);
  assert.match(uploadRoute, /owner: profile/);
  assert.match(uploadRoute, /getProfile/);
  assert.match(uploadRoute, /uploadId/);
  assert.match(uploadRoute, /UPLOAD_ID_PATTERN/);
  assert.match(nextConfig, /bodySizeLimit: "10mb"/);
  assert.match(photoRoute, /canRead/);
  assert.match(photoRoute, /canDelete/);
  assert.match(photoRoute, /new Response\(object\.body\)\.arrayBuffer\(\)/);
  assert.match(photoRoute, /for \(let attempt = 0; attempt < 2; attempt \+= 1\)/);
  assert.match(photoRoute, /cache-control", "private, max-age=3600, immutable/);
});

test("protects profile access and check-ins on the server", async () => {
  const [masterRoute, profileRoute, authHelper, checkInRoute] = await Promise.all([
    readFile(new URL("../app/api/auth/session/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/auth/profile/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/lib/password-auth.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/check-ins/route.ts", import.meta.url), "utf8"),
  ]);

  assert.match(masterRoute, /clearProfileCookie/);
  assert.match(profileRoute, /verifyProfilePassword/);
  assert.match(profileRoute, /createProfileCookie/);
  assert.match(authHelper, /HttpOnly/);
  assert.match(authHelper, /SameSite=Strict/);
  assert.match(authHelper, /COCONUT_PASSWORD/);
  assert.match(authHelper, /XUANMEI_PASSWORD/);
  assert.match(checkInRoute, /getProfile/);
  assert.match(checkInRoute, /checkins\//);
  assert.match(checkInRoute, /visibility/);
});

test("keeps personal tools isolated and supports profile-password updates", async () => {
  const [component, authHelper, passwordRoute, memoRoute, cycleRoute, photoRoute] = await Promise.all([
    readFile(new URL("../app/MemoryKeeper.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/lib/password-auth.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/auth/profile/password/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/memos/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/cycle/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/photos/route.ts", import.meta.url), "utf8"),
  ]);

  assert.match(component, /mood-marker/);
  assert.match(component, /椰子的周期小日历/);
  assert.match(component, /api\/memos/);
  assert.match(component, /api\/auth\/profile\/password/);
  assert.match(authHelper, /changeProfilePassword/);
  assert.match(authHelper, /PBKDF2/);
  assert.match(passwordRoute, /getProfile/);
  assert.match(passwordRoute, /createProfileCookie/);
  assert.match(memoRoute, /memos\/\$\{profile\}/);
  assert.match(memoRoute, /getProfile/);
  assert.match(cycleRoute, /profile === "coconut"/);
  assert.match(cycleRoute, /periods\/coconut/);
  assert.match(photoRoute, /!object\.key\.includes\("\/"\)/);
});

test("uses reversible visibility buttons and compact calendar markers", async () => {
  const [component, styles] = await Promise.all([
    readFile(new URL("../app/MemoryKeeper.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
  ]);

  assert.match(component, /role="group" aria-label="回忆可见范围"/);
  assert.match(component, /type="button" className=\{memoryDraft\.visibility === "public"/);
  assert.match(component, /type="button" className=\{memoryDraft\.visibility === "private"/);
  assert.doesNotMatch(component, /name="memory-visibility"/);
  assert.doesNotMatch(component, /同一天会同时显示椰子和炫妹/);
  assert.doesNotMatch(component, /标记生理期开始和结束后/);
  assert.doesNotMatch(component, /颜色预测只用于日历记录/);
  assert.match(styles, /\.mood-markers \{[\s\S]*right: 6px;[\s\S]*flex-direction: column;/);
  assert.match(styles, /\.mood-marker \{[\s\S]*width: 18px;[\s\S]*height: 18px;/);
});

test("renders memories as an interactive album viewer", async () => {
  const [component, styles] = await Promise.all([
    readFile(new URL("../app/MemoryKeeper.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
  ]);

  assert.match(component, /className="album-grid"/);
  assert.match(component, /className=\{`album-tile/);
  assert.match(component, /role="dialog" aria-modal="true"/);
  assert.match(component, /viewer-zoom-controls/);
  assert.match(component, /memoryZoom/);
  assert.match(component, /memoryPan/);
  assert.match(component, /onPointerMove=\{handleViewerPointerMove\}/);
  assert.match(component, /onDoubleClick=\{handleViewerDoubleClick\}/);
  assert.match(component, /ArrowLeft/);
  assert.match(component, /ArrowRight/);
  assert.match(component, /shouldRetryPhotoUpload/);
  assert.match(component, /formData\.set\("uploadId", crypto\.randomUUID\(\)\)/);
  assert.doesNotMatch(component, /timeline-section/);
  assert.match(styles, /\.album-grid \{[\s\S]*column-count: 4;/);
  assert.match(styles, /\.album-tile img \{[\s\S]*height: auto;/);
  assert.match(styles, /\.viewer-media \{[\s\S]*height: clamp\(360px, 72dvh, 610px\);/);
  assert.match(styles, /\.viewer-media img \{[\s\S]*position: absolute;[\s\S]*inset: 0;[\s\S]*width: 100%;[\s\S]*height: 100%;[\s\S]*object-fit: contain;/);
  assert.match(styles, /\.viewer-media\.has-image \{[\s\S]*touch-action: none;/);
  assert.match(component, /loading="lazy" decoding="async"/);
  assert.match(styles, /\.memory-viewer \{[\s\S]*position: fixed;/);
  assert.match(styles, /@keyframes viewer-panel-in/);
});

test("does not retain starter preview references", async () => {
  const [page, layout, packageJson] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/layout.tsx", import.meta.url), "utf8"),
    readFile(new URL("../package.json", import.meta.url), "utf8"),
  ]);

  assert.doesNotMatch(page, /SkeletonPreview|codex-preview|_sites-preview/);
  assert.doesNotMatch(layout, /Starter Project|codex-preview|_sites-preview/);
  assert.doesNotMatch(packageJson, /react-loading-skeleton/);
});
