import { describe, expect, test } from "@rstest/core";
import { isSameSiteUrl, normalizeSite, normalizeSiteUrl } from "../src/settings";

describe("settings URL normalization", () => {
  test("trims whitespace and removes trailing slashes", () => {
    expect(normalizeSiteUrl(" https://halo.example.com/// ")).toBe("https://halo.example.com");
  });

  test("normalizes a site without changing other fields", () => {
    expect(
      normalizeSite({
        name: "Blog",
        url: "https://halo.example.com/",
        token: "token",
        default: true,
      }),
    ).toEqual({
      name: "Blog",
      url: "https://halo.example.com",
      token: "token",
      default: true,
    });
  });

  test("compares site URLs after normalization", () => {
    expect(isSameSiteUrl(" https://halo.example.com/ ", "https://halo.example.com")).toBe(true);
    expect(isSameSiteUrl("https://halo.example.com/blog", "https://halo.example.com")).toBe(false);
  });
});
