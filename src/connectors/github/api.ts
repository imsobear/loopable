export type GithubUser = {
  login: string;
  id: number;
  html_url: string;
  avatar_url: string;
};

export async function getViewer(
  accessToken: string,
): Promise<{ user: GithubUser; scopes: string[] }> {
  const res = await fetch("https://api.github.com/user", {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: "application/vnd.github+json",
      "User-Agent": "loopable",
      "X-GitHub-Api-Version": "2022-11-28",
    },
  });
  if (!res.ok) {
    throw new Error(`GitHub ${res.status} on /user: ${(await res.text()).slice(0, 200)}`);
  }
  const user = (await res.json()) as GithubUser;
  const scopes = (res.headers.get("x-oauth-scopes") ?? "")
    .split(",")
    .map((scope) => scope.trim())
    .filter(Boolean);
  return { user, scopes };
}
