/**
 * Unit tests for resolveDownload (ticket #42, extended in #73 for the
 * single-zip Deliverable): the pure decision function behind the download
 * route. Fakes both seams (token lookup, bucket read) so the route itself
 * stays a thin Request/Response adapter -- see route.ts.
 */
import { describe, expect, it } from "vitest";
import { DELIVERABLE_CONTENT_TYPES, quizZipFilename } from "@/domain";
import { resolveDownload, type ResolveDownloadDeps, type DownloadQuizLookup } from "./resolve-download";

const QUIZ_ID = "quiz-123";
const TOKEN = "tok-abc";

function fakeQuiz(overrides: Partial<DownloadQuizLookup> = {}): DownloadQuizLookup {
  return {
    id: QUIZ_ID,
    prunedAt: null,
    wooOrderId: 101,
    sequenceInOrder: 0,
    locale: "nl",
    ...overrides,
  };
}

function buildDeps(overrides: Partial<ResolveDownloadDeps> = {}): ResolveDownloadDeps {
  return {
    getQuizByDownloadToken: async (token) => (token === TOKEN ? fakeQuiz() : null),
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
        return fakeQuiz();
      },
    });

    const result = await resolveDownload(TOKEN, "not-a-real-file.pdf", deps);

    expect(result).toEqual({ status: 404 });
    expect(lookedUp).toBe(false);
  });

  it("404s an unknown token", async () => {
    const deps = buildDeps({ getQuizByDownloadToken: async () => null });

    const result = await resolveDownload("unknown-token", "quiz.zip", deps);

    expect(result).toEqual({ status: 404 });
  });

  it("410s a pruned Quiz (prunedAt set) without ever touching the bucket", async () => {
    let bucketTouched = false;
    const deps = buildDeps({
      getQuizByDownloadToken: async () => fakeQuiz({ prunedAt: "2026-01-01T03:00:00.000Z" }),
      downloadDeliverable: async () => {
        bucketTouched = true;
        return new Uint8Array([1, 2, 3]);
      },
    });

    const result = await resolveDownload(TOKEN, "quiz.zip", deps);

    expect(result).toEqual({ status: 410 });
    expect(bucketTouched).toBe(false);
  });

  it("410s when the token is known and not pruned but the object is nonetheless gone from the bucket", async () => {
    const deps = buildDeps({
      downloadDeliverable: async () => {
        throw new Error("Object not found");
      },
    });

    const result = await resolveDownload(TOKEN, "quiz.zip", deps);

    expect(result).toEqual({ status: 410 });
  });

  it("200s the zip with its body, Content-Type, and the pubquiz-<order>-<sequence>-<locale>.zip file name", async () => {
    const body = new Uint8Array([9, 9, 9]);
    const deps = buildDeps({
      getQuizByDownloadToken: async () => fakeQuiz({ wooOrderId: 101, sequenceInOrder: 2, locale: "en" }),
      downloadDeliverable: async (path) => (path === `${QUIZ_ID}/quiz.zip` ? body : Promise.reject(new Error("wrong path"))),
    });

    const result = await resolveDownload(TOKEN, "quiz.zip", deps);

    expect(result).toEqual({
      status: 200,
      body,
      contentType: DELIVERABLE_CONTENT_TYPES["quiz.zip"],
      filename: quizZipFilename(101, 2, "en"),
    });
  });
});
