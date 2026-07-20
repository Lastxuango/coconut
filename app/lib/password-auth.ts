import { getBucket } from "@/app/lib/private-storage";

export type LoveProfile = "coconut" | "xuanmei";

const SESSION_COOKIE_NAME = "love_memory_session";
const PROFILE_COOKIE_NAME = "love_memory_profile";
const PROFILE_CREDENTIALS_KEY = "settings/profile-credentials.json";
const SESSION_DURATION_SECONDS = 60 * 60 * 24 * 30;
const PASSWORD_ITERATIONS = 100_000;
const encoder = new TextEncoder();

type StoredCredential = {
  hash: string;
  salt: string;
  version: number;
};

type CredentialStore = {
  version: 1;
  profiles: Partial<Record<LoveProfile, StoredCredential>>;
};

function masterConfiguration() {
  const password = process.env.MEMORY_PASSWORD?.trim();
  const sessionSecret = process.env.MEMORY_SESSION_SECRET?.trim();

  if (!password || !sessionSecret) {
    throw new Error("Password protection is not configured.");
  }

  return { password, sessionSecret };
}

function profileConfiguration() {
  const coconut = process.env.COCONUT_PASSWORD?.trim();
  const xuanmei = process.env.XUANMEI_PASSWORD?.trim();

  if (!coconut || !xuanmei) {
    throw new Error("Profile passwords are not configured.");
  }

  return { coconut, xuanmei };
}

function toBase64Url(bytes: Uint8Array) {
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }

  return btoa(binary)
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/, "");
}

async function digest(value: string) {
  const result = await crypto.subtle.digest("SHA-256", encoder.encode(value));
  return new Uint8Array(result);
}

async function passwordHash(password: string, salt: string) {
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(password),
    { name: "PBKDF2" },
    false,
    ["deriveBits"],
  );
  const bits = await crypto.subtle.deriveBits(
    {
      name: "PBKDF2",
      hash: "SHA-256",
      iterations: PASSWORD_ITERATIONS,
      salt: encoder.encode(salt),
    },
    key,
    256,
  );
  return toBase64Url(new Uint8Array(bits));
}

function randomSalt() {
  const bytes = new Uint8Array(18);
  crypto.getRandomValues(bytes);
  return toBase64Url(bytes);
}

async function signature(value: string, secret: string) {
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signed = await crypto.subtle.sign("HMAC", key, encoder.encode(value));
  return toBase64Url(new Uint8Array(signed));
}

function safeEqual(left: Uint8Array | string, right: Uint8Array | string) {
  const longest = Math.max(left.length, right.length);
  let difference = left.length ^ right.length;

  for (let index = 0; index < longest; index += 1) {
    const leftValue =
      typeof left === "string" ? left.charCodeAt(index) || 0 : left[index] || 0;
    const rightValue =
      typeof right === "string"
        ? right.charCodeAt(index) || 0
        : right[index] || 0;
    difference |= leftValue ^ rightValue;
  }

  return difference === 0;
}

function readCookie(header: string | null, name: string) {
  if (!header) {
    return null;
  }

  for (const part of header.split(";")) {
    const [key, ...value] = part.trim().split("=");
    if (key === name) {
      return value.join("=");
    }
  }

  return null;
}

function isSecureRequest(request: Request) {
  return (
    new URL(request.url).protocol === "https:" ||
    request.headers.get("x-forwarded-proto") === "https"
  );
}

function cookieOptions(request: Request, maxAge: number) {
  return [
    "HttpOnly",
    "Path=/",
    "SameSite=Strict",
    `Max-Age=${maxAge}`,
    ...(isSecureRequest(request) ? ["Secure"] : []),
  ].join("; ");
}

function isLoveProfile(value: string): value is LoveProfile {
  return value === "coconut" || value === "xuanmei";
}

function emptyCredentialStore(): CredentialStore {
  return { version: 1, profiles: {} };
}

function isStoredCredential(value: unknown): value is StoredCredential {
  if (!value || typeof value !== "object") {
    return false;
  }

  const credential = value as Partial<StoredCredential>;
  const version = credential.version;
  return (
    typeof credential.hash === "string" &&
    typeof credential.salt === "string" &&
    typeof version === "number" &&
    Number.isSafeInteger(version) &&
    version >= 1
  );
}

async function readCredentialStore(): Promise<CredentialStore> {
  const object = await getBucket().get(PROFILE_CREDENTIALS_KEY);
  if (!object) {
    return emptyCredentialStore();
  }

  const parsed = (await new Response(object.body).json()) as Partial<CredentialStore>;
  if (parsed.version !== 1 || !parsed.profiles || typeof parsed.profiles !== "object") {
    throw new Error("Stored profile credentials are invalid.");
  }

  const profiles: CredentialStore["profiles"] = {};
  if (isStoredCredential(parsed.profiles.coconut)) {
    profiles.coconut = parsed.profiles.coconut;
  }
  if (isStoredCredential(parsed.profiles.xuanmei)) {
    profiles.xuanmei = parsed.profiles.xuanmei;
  }

  return { version: 1, profiles };
}

async function saveCredentialStore(store: CredentialStore) {
  await getBucket().put(PROFILE_CREDENTIALS_KEY, JSON.stringify(store), {
    httpMetadata: { contentType: "application/json; charset=utf-8" },
  });
}

async function profileMatches(
  profile: LoveProfile,
  candidate: string,
  store: CredentialStore,
) {
  const stored = store.profiles[profile];
  if (stored) {
    return safeEqual(await passwordHash(candidate, stored.salt), stored.hash);
  }

  const configured = profileConfiguration()[profile];
  const [candidateDigest, configuredDigest] = await Promise.all([
    digest(candidate),
    digest(configured),
  ]);
  return safeEqual(candidateDigest, configuredDigest);
}

async function profileVersion(profile: LoveProfile) {
  const store = await readCredentialStore();
  return store.profiles[profile]?.version ?? 0;
}

export async function verifyPassword(candidate: unknown) {
  if (typeof candidate !== "string") {
    return false;
  }

  const { password } = masterConfiguration();
  const [candidateDigest, expectedDigest] = await Promise.all([
    digest(candidate),
    digest(password),
  ]);

  return safeEqual(candidateDigest, expectedDigest);
}

export async function verifyProfilePassword(
  candidate: unknown,
): Promise<LoveProfile | null> {
  if (typeof candidate !== "string") {
    return null;
  }

  const store = await readCredentialStore();
  const [coconutMatches, xuanmeiMatches] = await Promise.all([
    profileMatches("coconut", candidate, store),
    profileMatches("xuanmei", candidate, store),
  ]);

  if (coconutMatches) {
    return "coconut";
  }

  return xuanmeiMatches ? "xuanmei" : null;
}

export async function changeProfilePassword(
  profile: LoveProfile,
  currentPassword: unknown,
  nextPassword: unknown,
) {
  if (
    typeof currentPassword !== "string" ||
    typeof nextPassword !== "string" ||
    nextPassword.length < 8 ||
    nextPassword.length > 128
  ) {
    return false;
  }

  const store = await readCredentialStore();
  if (!(await profileMatches(profile, currentPassword, store))) {
    return false;
  }

  const previousVersion = store.profiles[profile]?.version ?? 0;
  const salt = randomSalt();
  store.profiles[profile] = {
    hash: await passwordHash(nextPassword, salt),
    salt,
    version: previousVersion + 1,
  };
  await saveCredentialStore(store);
  return true;
}

export async function isAuthenticated(request: Request) {
  const token = readCookie(request.headers.get("cookie"), SESSION_COOKIE_NAME);
  if (!token) {
    return false;
  }

  const separator = token.indexOf(".");
  if (separator <= 0) {
    return false;
  }

  const expiresAt = Number(token.slice(0, separator));
  if (!Number.isSafeInteger(expiresAt) || expiresAt <= Date.now()) {
    return false;
  }

  const { sessionSecret } = masterConfiguration();
  const expected = await signature(`master:${expiresAt}`, sessionSecret);
  return safeEqual(token.slice(separator + 1), expected);
}

export async function getProfile(request: Request): Promise<LoveProfile | null> {
  if (!(await isAuthenticated(request))) {
    return null;
  }

  const token = readCookie(request.headers.get("cookie"), PROFILE_COOKIE_NAME);
  if (!token) {
    return null;
  }

  const [profile, expiry, versionText, signed] = token.split(".");
  const expiresAt = Number(expiry);
  const version = Number(versionText);
  if (
    !profile ||
    !signed ||
    !isLoveProfile(profile) ||
    !Number.isSafeInteger(expiresAt) ||
    !Number.isSafeInteger(version) ||
    expiresAt <= Date.now() ||
    version !== (await profileVersion(profile))
  ) {
    return null;
  }

  const { sessionSecret } = masterConfiguration();
  const expected = await signature(
    `profile:${profile}:${expiresAt}:${version}`,
    sessionSecret,
  );
  return safeEqual(signed, expected) ? profile : null;
}

export async function createSessionCookie(request: Request) {
  const expiresAt = Date.now() + SESSION_DURATION_SECONDS * 1000;
  const { sessionSecret } = masterConfiguration();
  const signed = await signature(`master:${expiresAt}`, sessionSecret);

  return `${SESSION_COOKIE_NAME}=${expiresAt}.${signed}; ${cookieOptions(request, SESSION_DURATION_SECONDS)}`;
}

export async function createProfileCookie(request: Request, profile: LoveProfile) {
  const expiresAt = Date.now() + SESSION_DURATION_SECONDS * 1000;
  const version = await profileVersion(profile);
  const { sessionSecret } = masterConfiguration();
  const signed = await signature(
    `profile:${profile}:${expiresAt}:${version}`,
    sessionSecret,
  );

  return `${PROFILE_COOKIE_NAME}=${profile}.${expiresAt}.${version}.${signed}; ${cookieOptions(request, SESSION_DURATION_SECONDS)}`;
}

export function clearSessionCookie(request: Request) {
  return `${SESSION_COOKIE_NAME}=; ${cookieOptions(request, 0)}`;
}

export function clearProfileCookie(request: Request) {
  return `${PROFILE_COOKIE_NAME}=; ${cookieOptions(request, 0)}`;
}

export function noStoreHeaders() {
  return { "cache-control": "no-store, private" };
}
