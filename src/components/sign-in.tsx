/** The sign-in link, coming back to `next` afterwards when there is one. */
export function signInHref(next?: string): string {
  return next ? `/api/auth/signin?next=${encodeURIComponent(next)}` : "/api/auth/signin";
}
