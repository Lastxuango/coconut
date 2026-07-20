# Coconut Memory Journal

A private two-person memory journal built with Next.js and Vercel Private Blob.

## Deploy on Vercel

1. Import this repository in Vercel.
2. In **Storage**, create a **Blob** store with **Private** access and connect it to this project. Vercel adds `BLOB_READ_WRITE_TOKEN` automatically.
3. Add the following Production and Preview environment variables:
   - `MEMORY_PASSWORD`
   - `MEMORY_SESSION_SECRET` (a long random string)
   - `COCONUT_PASSWORD`
   - `XUANMEI_PASSWORD`
4. Deploy the `main` branch. Vercel detects this as a Next.js project and produces `.next` automatically.

The Blob store is private: photos and records are served only through the authenticated API routes.

## Local Development

```bash
pnpm install
copy .env.local.example .env.local
pnpm dev
```

Fill `.env.local` with private values and a Blob token before using uploads locally.

## Import Existing Cloudflare Data

The old Cloudflare-hosted data cannot be read directly by Vercel. After the new Vercel project and Blob store are configured, add the Blob token to your ignored local `.env.local`, then run the one-time import script. It reads the old site through its authenticated APIs and writes the memories, photos, check-ins, cycles, and memos into Private Blob.

```powershell
pnpm exec node scripts/migrate-cloudflare-data.mjs
```

The script defaults to the existing password values in `.env.local`. If either personal password has changed since the Cloudflare site was first deployed, set the matching temporary `LEGACY_COCONUT_PASSWORD` or `LEGACY_XUANMEI_PASSWORD` variable before running it. The script does not save passwords or tokens. Profile passwords must be set as Vercel environment variables before deploying the migrated site.
