/**
 * Runtime URL prefix for the app, mirrored from Next.js's `basePath`
 * config. Read once at module load — `NEXT_PUBLIC_BASE_PATH` is inlined
 * by Next.js at build time, so this is a string constant by the time
 * any client code reads it.
 *
 * Why we need it
 * --------------
 * Next.js's `<Link>` and `useRouter().push()` automatically prepend
 * basePath to navigations. But raw `fetch("/api/...")` calls do *not* —
 * the browser sends them to the literal path. When the app is mounted
 * under a prefix (e.g. `/avatar-editor/`), unprefixed fetches miss the
 * upstream entirely and 404 at the reverse proxy.
 *
 * Use `apiUrl()` for any client-side fetch to an internal API route.
 */

export const BASE_PATH: string = process.env.NEXT_PUBLIC_BASE_PATH ?? "";

/**
 * Build an absolute-from-root URL for an internal API route, prefixed
 * with BASE_PATH when the app is hosted under one.
 *
 * @param path Path starting with "/" (e.g. `/api/ai/providers`).
 */
export function apiUrl(path: string): string {
  return `${BASE_PATH}${path}`;
}
