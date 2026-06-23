import { beforeEach, describe, expect, rs, test } from "@rstest/core";
import type { App, RequestUrlParam } from "obsidian";
import { TFile, requestUrl } from "obsidian";
import HaloService from "../../src/service";
import type { HaloSetting, HaloSite } from "../../src/settings";

interface RequestUrlMock {
  mock: {
    calls: [RequestUrlParam][];
  };
  mockImplementation: (implementation: (request: RequestUrlParam) => unknown) => void;
  mockReset: () => void;
}

interface MockAppParts {
  app: App;
  contents: Map<string, string>;
  fileManager: {
    processFrontMatter: ReturnType<typeof rs.fn>;
  };
  metadataCache: {
    getFileCache: ReturnType<typeof rs.fn>;
    getFirstLinkpathDest: ReturnType<typeof rs.fn>;
  };
  vault: {
    getAbstractFileByPath: ReturnType<typeof rs.fn>;
    modify: ReturnType<typeof rs.fn>;
    read: ReturnType<typeof rs.fn>;
    readBinary: ReturnType<typeof rs.fn>;
  };
}

const site: HaloSite = {
  name: "Halo",
  url: "https://halo.example.com",
  token: "token",
  default: true,
};

function createSettings(overrides: Partial<HaloSetting> = {}): HaloSetting {
  return {
    sites: [site],
    publishByDefault: false,
    replaceImageLinks: true,
    imageUploadCache: {},
    ...overrides,
  };
}

function createFile(path: string, size = 100, mtime = 1000): TFile {
  const file = new TFile();
  const name = path.split("/").pop() || path;
  const extension = name.includes(".") ? name.split(".").pop() || "" : "";
  const basename = extension ? name.slice(0, -(extension.length + 1)) : name;
  const parentPath = path.split("/").slice(0, -1).join("/");

  Object.assign(file, {
    basename,
    extension,
    name,
    parent: parentPath
      ? {
          name: parentPath.split("/").pop() || parentPath,
          path: parentPath,
        }
      : null,
    path,
    stat: {
      ctime: mtime,
      mtime,
      size,
    },
  });

  return file;
}

function createMockApp(markdown: string, activeFile: TFile, files: TFile[]): MockAppParts {
  const contents = new Map<string, string>([[activeFile.path, markdown]]);
  const filesByPath = new Map<string, TFile>([[activeFile.path, activeFile]]);

  for (const file of files) {
    filesByPath.set(file.path, file);
  }

  const vault = {
    getAbstractFileByPath: rs.fn((path: string) => filesByPath.get(path)),
    modify: rs.fn(async (file: TFile, updatedMarkdown: string) => {
      contents.set(file.path, updatedMarkdown);
    }),
    read: rs.fn(async (file: TFile) => contents.get(file.path) || ""),
    readBinary: rs.fn(async () => new TextEncoder().encode("image").buffer),
  };

  const metadataCache = {
    getFileCache: rs.fn(() => ({ frontmatter: {} })),
    getFirstLinkpathDest: rs.fn((linkPath: string) => filesByPath.get(linkPath)),
  };

  const fileManager = {
    processFrontMatter: rs.fn((file: TFile, callback: (frontmatter: Record<string, unknown>) => void) => {
      callback({});
    }),
  };

  return {
    app: {
      fileManager,
      metadataCache,
      vault,
      workspace: {
        activeEditor: {
          file: activeFile,
        },
      },
    } as unknown as App,
    contents,
    fileManager,
    metadataCache,
    vault,
  };
}

function requestUrlMock(): RequestUrlMock {
  return requestUrl as unknown as RequestUrlMock;
}

function mockAttachmentUploads(...permalinks: string[]): void {
  let index = 0;

  requestUrlMock().mockImplementation(() => {
    const permalink = permalinks[index];
    index += 1;

    if (!permalink) {
      throw new Error("Unexpected upload");
    }

    return {
      json: {
        status: {
          permalink,
        },
      },
    };
  });
}

describe("HaloService.uploadImages", () => {
  beforeEach(() => {
    requestUrlMock().mockReset();
  });

  test("uploads local markdown and wiki images, skips remote images, and writes replaced markdown", async () => {
    const note = createFile("posts/post.md");
    const logo = createFile("images/logo.png", 10, 100);
    const banner = createFile("images/banner.png", 20, 200);
    const markdown = [
      "![Logo](images/logo.png)",
      "![[images/banner.png|Hero]]",
      "![Remote](https://cdn.example.com/remote.png)",
      "[Normal link](images/logo.png)",
    ].join("\n");
    const { contents, vault, app } = createMockApp(markdown, note, [logo, banner]);
    const service = new HaloService(app, createSettings(), site);

    mockAttachmentUploads("/uploads/logo.png", "/uploads/banner.png");

    const result = await service.uploadImages({ silent: true });

    const expectedMarkdown = [
      "![Logo](https://halo.example.com/uploads/logo.png)",
      "![Hero](https://halo.example.com/uploads/banner.png)",
      "![Remote](https://cdn.example.com/remote.png)",
      "[Normal link](images/logo.png)",
    ].join("\n");

    expect(result).toMatchObject({
      failedCount: 0,
      processedCount: 2,
      replaced: true,
      reusedCount: 0,
      uploadedCount: 2,
    });
    expect(result.markdown).toBe(expectedMarkdown);
    expect(contents.get(note.path)).toBe(expectedMarkdown);
    expect(vault.modify).toHaveBeenCalledTimes(1);
    expect(requestUrlMock().mock.calls).toHaveLength(2);
  });

  test("leaves remote-only markdown from Halo updates untouched", async () => {
    const note = createFile("post.md");
    const markdown = [
      "![Halo](https://halo.example.com/uploads/logo.png)",
      "![Protocol relative](//cdn.example.com/banner.png)",
      "![Anchor](#local-anchor)",
    ].join("\n");
    const { contents, vault, app } = createMockApp(markdown, note, []);
    const service = new HaloService(app, createSettings(), site);

    const result = await service.uploadImages({ silent: true });

    expect(result).toMatchObject({
      failedCount: 0,
      processedCount: 0,
      replaced: false,
      reusedCount: 0,
      uploadedCount: 0,
    });
    expect(result.markdown).toBe(markdown);
    expect(contents.get(note.path)).toBe(markdown);
    expect(vault.modify).not.toHaveBeenCalled();
    expect(requestUrlMock().mock.calls).toHaveLength(0);
  });

  test("uploads encoded markdown image targets wrapped in angle brackets", async () => {
    const note = createFile("post.md");
    const logo = createFile("images/my logo.png", 10, 100);
    const markdown = "![Logo](<images/my%20logo.png>)";
    const { app } = createMockApp(markdown, note, [logo]);
    const service = new HaloService(app, createSettings(), site);

    mockAttachmentUploads("/uploads/my-logo.png");

    const result = await service.uploadImages({ silent: true });

    expect(result).toMatchObject({
      failedCount: 0,
      processedCount: 1,
      replaced: true,
      uploadedCount: 1,
    });
    expect(result.markdown).toBe("![Logo](<https://halo.example.com/uploads/my-logo.png>)");
  });

  test("returns uploaded markdown without modifying the note when replacement is disabled", async () => {
    const note = createFile("post.md");
    const logo = createFile("logo.png", 10, 100);
    const markdown = "![Logo](logo.png)";
    const { contents, vault, app } = createMockApp(markdown, note, [logo]);
    const service = new HaloService(app, createSettings({ replaceImageLinks: false }), site);

    mockAttachmentUploads("/uploads/logo.png");

    const result = await service.uploadImages({ silent: true });

    expect(result).toMatchObject({
      failedCount: 0,
      processedCount: 1,
      replaced: false,
      uploadedCount: 1,
    });
    expect(result.markdown).toBe("![Logo](https://halo.example.com/uploads/logo.png)");
    expect(contents.get(note.path)).toBe(markdown);
    expect(vault.modify).not.toHaveBeenCalled();
  });

  test("reuses a valid local upload cache entry instead of uploading again", async () => {
    const note = createFile("post.md");
    const logo = createFile("logo.png", 10, 100);
    const settings = createSettings({
      imageUploadCache: {
        "https://halo.example.com": {
          "logo.png": {
            filePath: "logo.png",
            mtime: 100,
            permalink: "https://halo.example.com/uploads/cached-logo.png",
            size: 10,
            updatedAt: 123,
          },
        },
      },
    });
    const { app } = createMockApp("![Logo](logo.png)", note, [logo]);
    const service = new HaloService(app, settings, site);

    requestUrlMock().mockImplementation(() => {
      throw new Error("cache should prevent uploads");
    });

    const result = await service.uploadImages({ silent: true });

    expect(result).toMatchObject({
      failedCount: 0,
      processedCount: 1,
      reusedCount: 1,
      uploadedCount: 0,
    });
    expect(result.markdown).toBe("![Logo](https://halo.example.com/uploads/cached-logo.png)");
    expect(requestUrlMock().mock.calls).toHaveLength(0);
  });

  test("ignores stale cache entries and refreshes the cache after upload", async () => {
    const note = createFile("post.md");
    const logo = createFile("logo.png", 10, 200);
    const settings = createSettings({
      imageUploadCache: {
        "https://halo.example.com": {
          "logo.png": {
            filePath: "logo.png",
            mtime: 100,
            permalink: "https://halo.example.com/uploads/old-logo.png",
            size: 10,
            updatedAt: 123,
          },
        },
      },
    });
    const { app } = createMockApp("![Logo](logo.png)", note, [logo]);
    const service = new HaloService(app, settings, site);

    mockAttachmentUploads("/uploads/new-logo.png");

    const result = await service.uploadImages({ silent: true });

    expect(result).toMatchObject({
      failedCount: 0,
      reusedCount: 0,
      uploadedCount: 1,
    });
    expect(result.markdown).toBe("![Logo](https://halo.example.com/uploads/new-logo.png)");
    expect(settings.imageUploadCache["https://halo.example.com"]["logo.png"]).toMatchObject({
      mtime: 200,
      permalink: "https://halo.example.com/uploads/new-logo.png",
      size: 10,
    });
  });

  test("does not write partial markdown when one image upload fails", async () => {
    const note = createFile("post.md");
    const logo = createFile("logo.png", 10, 100);
    const banner = createFile("banner.png", 20, 200);
    const markdown = ["![Logo](logo.png)", "![Banner](banner.png)"].join("\n");
    const { contents, vault, app } = createMockApp(markdown, note, [logo, banner]);
    const service = new HaloService(app, createSettings(), site);
    const consoleError = rs.spyOn(console, "error").mockImplementation(() => undefined);
    let calls = 0;

    requestUrlMock().mockImplementation(() => {
      calls += 1;

      if (calls === 2) {
        throw new Error("upload failed");
      }

      return {
        json: {
          status: {
            permalink: "/uploads/logo.png",
          },
        },
      };
    });

    try {
      const result = await service.uploadImages({ silent: true });

      expect(result).toMatchObject({
        failedCount: 1,
        processedCount: 1,
        replaced: false,
        uploadedCount: 1,
      });
      expect(result.markdown).toBe(
        ["![Logo](https://halo.example.com/uploads/logo.png)", "![Banner](banner.png)"].join("\n"),
      );
      expect(contents.get(note.path)).toBe(markdown);
      expect(vault.modify).not.toHaveBeenCalled();
      expect(consoleError).toHaveBeenCalledWith("Error uploading image:", expect.any(Error));
    } finally {
      consoleError.mockRestore();
    }
  });
});

describe("HaloService.publishPost", () => {
  beforeEach(() => {
    requestUrlMock().mockReset();
  });

  test("publishes the provided markdown instead of rereading the local note", async () => {
    const note = createFile("post.md");
    const { app, metadataCache, vault } = createMockApp("local markdown ![Logo](logo.png)", note, []);
    const service = new HaloService(app, createSettings(), site);
    let createdPostBody: Record<string, unknown> | undefined;

    metadataCache.getFileCache.mockImplementation(() => ({
      frontmatter: {
        title: "Post title",
      },
    }));
    requestUrlMock().mockImplementation((request: RequestUrlParam) => {
      const url = typeof request === "string" ? request : request.url;

      if (typeof request !== "string" && request.method === "POST" && url.endsWith("/posts")) {
        createdPostBody = JSON.parse(typeof request.body === "string" ? request.body : "{}") as Record<string, unknown>;
        return {
          json: createdPostBody,
        };
      }

      if (url.includes("/categories") || url.includes("/tags")) {
        return {
          json: {
            items: [],
          },
        };
      }

      throw new Error(`Unexpected request: ${url}`);
    });

    await service.publishPost({
      markdown: "published markdown ![Logo](https://halo.example.com/uploads/logo.png)",
    });

    const metadata = createdPostBody?.metadata as { annotations?: Record<string, string> };
    const content = JSON.parse(metadata.annotations?.["content.halo.run/content-json"] || "{}") as {
      raw?: string;
    };

    expect(vault.read).not.toHaveBeenCalled();
    expect(content.raw).toBe("published markdown ![Logo](https://halo.example.com/uploads/logo.png)");
  });
});
