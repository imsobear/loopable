/** The sign-in link for a provider, coming back to `next` afterwards when there is one. */
export function signInHref(next?: string, provider: "github" | "google" = "github"): string {
  const query = new URLSearchParams();
  if (provider !== "github") query.set("provider", provider);
  if (next) query.set("next", next);
  const search = query.toString();
  return search ? `/api/auth/signin?${search}` : "/api/auth/signin";
}
