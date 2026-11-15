import { describe, it, expect } from "vitest";
import { ToolSearchIndex, osaDistance, stem, tokenize, type SearchableTool } from "./search.js";

const t = (name: string, description: string, effect: SearchableTool["effect"] = "read"): SearchableTool => ({
  name,
  server: name.slice(0, name.indexOf(".")),
  description,
  effect,
});

const CATALOG: SearchableTool[] = [
  t("github.createPullRequest", "Open a pull request from a head branch into a base branch", "write"),
  t("github.listPullRequests", "List pull requests in a repository"),
  t("github.listIssues", "List issues in a repository"),
  t("github.createIssue", "Create an issue in a repository", "write"),
  t("gitlab.create_merge_request", "Create a merge request in a GitLab project", "write"),
  t("gitlab.list_pipelines", "List CI pipelines for a project"),
  t("jira.create_issue", "Create a Jira issue in a project", "write"),
  t("jira.search_issues", "Search Jira issues with JQL"),
  t("jira.transition_issue", "Move a Jira issue to another status", "write"),
  t("slack.send_message", "Send a message to a Slack channel", "destructive"),
  t("slack.list_channels", "List Slack channels the user can see"),
  t("gmail.send_email", "Send an email on the user's behalf", "destructive"),
  t("gmail.list_messages", "List email messages in the inbox"),
  t("calendar.list_events", "List calendar events in a time range"),
  t("crm.select_customers", "Read rows from public.customers"),
  t("crm.count_customers", "Count rows in public.customers"),
  t("newrelic.query_nrql", "Run an NRQL query against New Relic. Mentions Jira tickets in examples."),
];

const index = new ToolSearchIndex(CATALOG);
const top = (q: string, opts?: Parameters<ToolSearchIndex["search"]>[1]) => index.search(q, opts)[0]?.name;
const names = (q: string, opts?: Parameters<ToolSearchIndex["search"]>[1]) => index.search(q, opts).map((h) => h.name);

describe("tokenize", () => {
  it("splits camelCase, snake_case and punctuation, drops stop words, stems", () => {
    expect(tokenize("createPullRequest")).toEqual(["creat", "pr"]);
    expect(tokenize("list_pipelines")).toEqual(["list", "pipelin"]);
    expect(tokenize("Open a pull request")).toEqual(["open", "pr"]);
    expect(tokenize("merge-requests")).toEqual(["mr"]);
    expect(tokenize("NRQLQuery")).toEqual(["nrql", "query"]);
  });

  it("stems plurals and verb forms to the same root", () => {
    expect(stem("issues")).toBe(stem("issue"));
    expect(stem("updated")).toBe(stem("update"));
    expect(stem("updating")).toBe(stem("updates"));
    expect(stem("prs")).toBe("pr");
    expect(stem("class")).toBe("class");
  });
});

describe("osaDistance", () => {
  it("counts an adjacent swap as one edit", () => {
    expect(osaDistance("emial", "email")).toBe(1);
    expect(osaDistance("issue", "issue")).toBe(0);
    expect(osaDistance("kitten", "sitting")).toBe(3);
    expect(osaDistance("", "abc")).toBe(3);
  });
});

describe("ToolSearchIndex", () => {
  it("finds a tool from task phrasing", () => {
    expect(top("create jira issue")).toBe("jira.create_issue");
    expect(top("send email")).toBe("gmail.send_email");
    expect(top("list calendar events")).toBe("calendar.list_events");
  });

  it("ignores word order", () => {
    expect(top("issue create jira")).toBe("jira.create_issue");
  });

  it("folds pull request / PR and merge request / MR", () => {
    expect(top("open a pull request")).toBe("github.createPullRequest");
    expect(top("list prs")).toBe("github.listPullRequests");
    expect(top("create merge request")).toBe("gitlab.create_merge_request");
  });

  it("matches synonyms", () => {
    expect(top("new jira ticket")).toBe("jira.create_issue");
    expect(top("find jira bugs")).toBe("jira.search_issues");
  });

  it("matches prefixes", () => {
    expect(top("calend")).toBe("calendar.list_events");
  });

  it("corrects typos in unknown words", () => {
    expect(top("send emial")).toBe("gmail.send_email");
    expect(top("crete jira isue")).toBe("jira.create_issue");
  });

  it("never corrects a real word", () => {
    const hits = names("gitlab");
    expect(hits.length).toBeGreaterThan(0);
    expect(hits.every((n) => n.startsWith("gitlab."))).toBe(true);
  });

  it("ranks name matches above description-only mentions", () => {
    const hits = names("jira", { limit: 50 });
    expect(hits.indexOf("newrelic.query_nrql")).toBeGreaterThan(hits.indexOf("jira.create_issue"));
    expect(hits.slice(0, 3).every((n) => n.startsWith("jira."))).toBe(true);
  });

  it("prefers tools matching every word over tools matching some", () => {
    const hits = names("list slack channels");
    expect(hits[0]).toBe("slack.list_channels");
    expect(hits.indexOf("slack.list_channels")).toBeLessThan(hits.indexOf("github.listIssues"));
  });

  it("puts an exact tool name first", () => {
    expect(top("jira.search_issues")).toBe("jira.search_issues");
    expect(top("count_customers")).toBe("crm.count_customers");
  });

  it("filters by server", () => {
    expect(names("list", { server: "github", limit: 50 }).every((n) => n.startsWith("github."))).toBe(true);
  });

  it("caps results at limit (default 10, max 50)", () => {
    expect(index.search("list", {}).length).toBeLessThanOrEqual(10);
    expect(index.search("a b c list", { limit: 2 })).toHaveLength(2);
    expect(index.search("list", { limit: 999 }).length).toBeLessThanOrEqual(50);
  });

  it("returns nothing for empty or meaningless queries", () => {
    expect(index.search("")).toEqual([]);
    expect(index.search("the a of")).toEqual([]);
    expect(index.search("zzzzqqq")).toEqual([]);
  });

  it("returns description, server and effect with each hit", () => {
    const hit = index.search("send slack message")[0]!;
    expect(hit).toMatchObject({ name: "slack.send_message", server: "slack", effect: "destructive" });
    expect(hit.score).toBeGreaterThan(0);
  });
});
