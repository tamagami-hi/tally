import { describe, expect, test } from "vitest";
import { placeOf } from "../src/place.ts";

describe("where a page is", () => {
  test("is a repository's board under /r/<name>/", () => {
    expect(placeOf("/r/alpha/")).toEqual({ repo: "alpha", api: "/api/r/alpha", events: "/api/r/alpha/events" });
  });

  test("keeps the repository for a route inside its board", () => {
    expect(placeOf("/r/my_repo-2/evidence").repo).toBe("my_repo-2");
  });

  test("names no repository at the root, and uses the paths that name none", () => {
    expect(placeOf("/")).toEqual({ repo: null, api: "/api", events: "/events" });
  });

  test("names no repository for a path that only looks like one", () => {
    expect(placeOf("/r/").repo).toBeNull();
    expect(placeOf("/r/Not-A-Name/").repo).toBeNull();
    expect(placeOf("/reports/alpha/").repo).toBeNull();
  });
});
