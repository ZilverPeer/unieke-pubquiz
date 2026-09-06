/**
 * Unit tests for resolveDownload (ticket #42): the pure decision function
 * behind the download route. Fakes both seams (token lookup, bucket read) so
 * the route itself stays a thin Request/Response adapter -- see route.ts.
 */
import { describe, expect, it } from "vitest";
import { DELIVERABLE_CONTENT_TYPES, DELIVERABLE_FILES, type DeliverableFile } from "@/domain";
import { resolveDownload, type ResolveDownloadDeps } from "./resolve-download";

const QUIZ_ID = "quiz-123";
const TOKEN = "tok-abc";

function buildDeps(overrides: Partial<ResolveDownloadDeps> = {}): ResolveDownloadDeps {
  return {
    getQuizByDownloadToken: async (token) => (token === TOKEN ? { id: QUIZ_ID } : null),
    downloadDeliverable: async () => new Uint8Array([1, 2, 3]),
    ...overrides,
  };
}

describe("resolveDownload", () => {
  it("404s a file name outside DELIVERABLE_FILES, without even looking up the token", async () => {
    let lookedUp = false;
    const deps = buildDeps({
      getQuizByDownloadToken: async () => {
        lookedUp = true;
        return { id: QUIZ_ID };
      },
    });

    const result = await resolveDownload(TOKEN, "not-a-real-file.pdf", deps);

    expect(result).toEqual({ status: 404 });
    expect(lookedUp).toBe(false);
  });

  it("404s an unknown token", async () => {
    const deps = buildDeps({ getQuizByDownloadToken: async () => null });

    const result = await resolveDownload("unknown-token", "quizmaster.pdf", deps);

    expect(result).toEqual({ status: 404 });
  });

  it("410s when the token is known but the object is gone from the bucket (pruned)", async () => {
    const deps = buildDeps({
      downloadDeliverable: async () => {
        throw new Error("Object not found");
      },
    });

    const result = await resolveDownload(TOKEN, "quizmaster.pdf", deps);

    expect(result).toEqual({ status: 410 });
  });

  it.each(DELIVERABLE_FILES)("200s %s with its body, Content-Type, and file name", async (file: DeliverableFile) => {
    const body = new Uint8Array([9, 9, 9]);
    const deps = buildDeps({ downloadDeliverable: async (path) => (path === `${QUIZ_ID}/${file}` ? body : Promise.reject(new Error("wrong path"))) });

    const result = await resolveDownload(TOKEN, file, deps);

    expect(result).toEqual({
      status: 200,
      body,
      contentType: DELIVERABLE_CONTENT_TYPES[file],
      filename: file,
    });
  });
});
