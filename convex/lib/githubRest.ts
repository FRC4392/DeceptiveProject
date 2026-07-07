// Thin GitHub REST client used by ../github.ts's write-back/import actions
// (commentOnGitHub, setGitHubState, importIssues).
const GITHUB_API = "https://api.github.com";

export function githubFetch(
  path: string,
  opts: { method?: string; token: string; body?: string },
): Promise<Response> {
  return fetch(`${GITHUB_API}${path}`, {
    method: opts.method ?? "GET",
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${opts.token}`,
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "deceivers-robotics-suite",
      ...(opts.body ? { "Content-Type": "application/json" } : {}),
    },
    body: opts.body,
  });
}
