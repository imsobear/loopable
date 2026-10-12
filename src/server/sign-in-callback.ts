import { appOrigin } from "#/lib/callback.ts";
import { completeSignIn, sessionCookie, type SignInProvider } from "./accounts.ts";

const LABEL: Record<SignInProvider, string> = { github: "GitHub", google: "Google" };

/** A provider sending a signed-in browser back: a session, then the page they wanted. */
export async function finishSignIn(request: Request, provider: SignInProvider): Promise<Response> {
  const origin = appOrigin(request.url);
  const url = new URL(request.url);
  const failed = (message: string) =>
    Response.redirect(`${origin}/?error=${encodeURIComponent(message)}`, 302);

  const denied = url.searchParams.get("error");
  if (denied) return failed(url.searchParams.get("error_description") ?? denied);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  if (!code || !state) return failed(`${LABEL[provider]} did not send a sign-in code back.`);

  try {
    const signedIn = await completeSignIn({ provider, code, state });
    return new Response(null, {
      status: 302,
      headers: {
        Location: `${origin}${signedIn.returnTo ?? "/inbox"}`,
        "Set-Cookie": sessionCookie(signedIn.sessionToken, origin.startsWith("https:")),
      },
    });
  } catch (error) {
    return failed(error instanceof Error ? error.message : String(error));
  }
}
