import type { Attachment, Category, Content, Post, Snapshot, Tag } from "@halo-dev/api-client";
import i18next from "i18next";
import { type App, Notice, TFile, getLinkpath, normalizePath, requestUrl } from "obsidian";
import { randomUUID } from "src/utils/id";
import markdownIt from "src/utils/markdown";
import { slugify } from "transliteration";
import { type HaloSetting, type HaloSite, type ImageUploadCacheEntry, isSameSiteUrl, normalizeSite } from "../settings";

interface LocalImageReference {
  file: TFile;
  start: number;
  end: number;
  replacement: (permalink: string) => string;
}

interface MarkdownImageTarget {
  path: string;
  rawPath: string;
  start: number;
}

interface UploadImagesResult {
  processedCount: number;
  uploadedCount: number;
  reusedCount: number;
  failedCount: number;
  markdown?: string;
  replaced: boolean;
}

interface HaloPostFrontmatter {
  title?: string;
  slug?: string;
  excerpt?: string;
  cover?: string;
  categories?: string[];
  tags?: string[];
  halo?: {
    site?: string;
    name?: string;
    publish?: boolean;
  };
}

const IMAGE_EXTENSIONS = new Set(["avif", "bmp", "gif", "ico", "jpeg", "jpg", "png", "svg", "tif", "tiff", "webp"]);
const PUBLISH_RETRY_COUNT = 3;
const PUBLISH_RETRY_DELAY_MS = 500;

const IMAGE_MIME_TYPES: Record<string, string> = {
  avif: "image/avif",
  bmp: "image/bmp",
  gif: "image/gif",
  ico: "image/x-icon",
  jpeg: "image/jpeg",
  jpg: "image/jpeg",
  png: "image/png",
  svg: "image/svg+xml",
  tif: "image/tiff",
  tiff: "image/tiff",
  webp: "image/webp",
};

class HaloService {
  private readonly site: HaloSite;
  private readonly app: App;
  private readonly settings: HaloSetting;
  private readonly headers: Record<string, string> = {};
  private readonly authHeaders: Record<string, string> = {};

  constructor(app: App, settings: HaloSetting, site: HaloSite) {
    this.app = app;
    this.settings = settings;
    this.site = normalizeSite(site);

    if (!this.settings.imageUploadCache) {
      this.settings.imageUploadCache = {};
    }

    this.authHeaders = {
      Authorization: `Bearer ${this.site.token}`,
    };

    this.headers = {
      "Content-Type": "application/json",
      ...this.authHeaders,
    };
  }

  public async getPost(name: string): Promise<{ post: Post; content: Content } | undefined> {
    try {
      const post = await this.getPostResource(name);
      const snapshot = await this.getPostDraft(name);

      const { "content.halo.run/patched-content": patchedContent, "content.halo.run/patched-raw": patchedRaw } =
        snapshot.metadata.annotations || {};

      const { rawType } = snapshot.spec || {};

      const content: Content = {
        content: patchedContent,
        raw: patchedRaw,
        rawType,
      };

      return Promise.resolve({
        post,
        content,
      });
    } catch (error) {
      return Promise.resolve(undefined);
    }
  }

  private async getPostResource(name: string): Promise<Post> {
    return (await requestUrl({
      url: `${this.site.url}/apis/uc.api.content.halo.run/v1alpha1/posts/${name}`,
      headers: this.headers,
    }).json) as Post;
  }

  private async getPostDraft(name: string): Promise<Snapshot> {
    return (await requestUrl({
      url: `${this.site.url}/apis/uc.api.content.halo.run/v1alpha1/posts/${name}/draft?patched=true`,
      headers: this.headers,
    }).json) as Snapshot;
  }

  public async publishPost(options: { markdown?: string } = {}): Promise<void> {
    const { activeEditor } = this.app.workspace;

    if (!activeEditor || !activeEditor.file) {
      return;
    }

    const activeFile = activeEditor.file;

    let params: Post = {
      apiVersion: "content.halo.run/v1alpha1",
      kind: "Post",
      metadata: {
        annotations: {},
        name: "",
      },
      spec: {
        allowComment: true,
        baseSnapshot: "",
        categories: [],
        cover: "",
        deleted: false,
        excerpt: {
          autoGenerate: true,
          raw: "",
        },
        headSnapshot: "",
        htmlMetas: [],
        owner: "",
        pinned: false,
        priority: 0,
        publish: false,
        publishTime: "",
        releaseSnapshot: "",
        slug: "",
        tags: [],
        template: "",
        title: "",
        visible: "PUBLIC",
      },
    };

    const md = options.markdown ?? (await this.app.vault.read(activeFile));
    const matterData = this.app.metadataCache.getFileCache(activeFile)?.frontmatter as HaloPostFrontmatter | undefined;
    const frontmatterPosition = this.app.metadataCache.getFileCache(activeFile)?.frontmatterPosition;

    const raw = frontmatterPosition ? md.slice(frontmatterPosition?.end.offset) : md;

    // check site url
    if (matterData?.halo?.site && !isSameSiteUrl(matterData.halo.site, this.site.url)) {
      new Notice(i18next.t("service.error_site_not_match"));
      return;
    }

    let categoryNames: string[] | undefined;
    if (matterData?.categories) {
      categoryNames = await this.getCategoryNames(matterData.categories);
    }

    let tagNames: string[] | undefined;
    if (matterData?.tags) {
      tagNames = await this.getTagNames(matterData.tags);
    }

    let remotePostName = matterData?.halo?.name;

    try {
      params = await this.withPublishRetry(async () => {
        if (remotePostName) {
          const latestPost = await this.getPostResource(remotePostName);
          params = this.applyPostFrontmatter(latestPost, {
            activeFile,
            categoryNames,
            matterData,
            tagNames,
            useActiveFileDefaults: false,
          });

          await requestUrl({
            url: `${this.site.url}/apis/uc.api.content.halo.run/v1alpha1/posts/${remotePostName}`,
            method: "PUT",
            contentType: "application/json",
            headers: this.headers,
            body: JSON.stringify(params),
          });

          const snapshot = await this.getPostDraft(remotePostName);
          const content = this.createPostContent(raw, snapshot.spec?.rawType);

          snapshot.metadata.annotations = {
            ...snapshot.metadata.annotations,
            "content.halo.run/content-json": JSON.stringify(content),
          };

          await requestUrl({
            url: `${this.site.url}/apis/uc.api.content.halo.run/v1alpha1/posts/${remotePostName}/draft`,
            method: "PUT",
            contentType: "application/json",
            headers: this.headers,
            body: JSON.stringify(snapshot),
          });
        } else {
          if (!params.metadata.name) {
            params.metadata.name = randomUUID();
          }

          params = this.applyPostFrontmatter(params, {
            activeFile,
            categoryNames,
            matterData,
            tagNames,
            useActiveFileDefaults: true,
          });

          params.metadata.annotations = {
            ...params.metadata.annotations,
            "content.halo.run/content-json": JSON.stringify(this.createPostContent(raw)),
          };

          const post = await requestUrl({
            url: `${this.site.url}/apis/uc.api.content.halo.run/v1alpha1/posts`,
            method: "POST",
            contentType: "application/json",
            headers: this.headers,
            body: JSON.stringify(params),
          }).json;

          params = post;
          remotePostName = params.metadata.name;
        }

        // Publish post
        // biome-ignore lint: no
        if (matterData?.halo?.hasOwnProperty("publish")) {
          if (matterData?.halo?.publish) {
            await this.changePostPublish(params.metadata.name, true);
          } else {
            await this.changePostPublish(params.metadata.name, false);
          }
        } else {
          if (this.settings.publishByDefault) {
            await this.changePostPublish(params.metadata.name, true);
          }
        }

        return params;
      });

      params = (await this.getPost(params.metadata.name))?.post || params;
    } catch (error) {
      new Notice(i18next.t("service.error_publish_failed"));
      return;
    }

    const postCategories = await this.getCategoryDisplayNames(params.spec.categories);
    const postTags = await this.getTagDisplayNames(params.spec.tags);

    this.app.fileManager.processFrontMatter(activeFile, (frontmatter) => {
      frontmatter.title = params.spec.title;
      frontmatter.slug = params.spec.slug;
      frontmatter.cover = params.spec.cover;
      frontmatter.excerpt = params.spec.excerpt.autoGenerate ? undefined : params.spec.excerpt.raw;
      frontmatter.categories = postCategories;
      frontmatter.tags = postTags;
      frontmatter.halo = {
        site: this.site.url,
        name: params.metadata.name,
        publish: params.spec.publish,
      };
    });

    new Notice(i18next.t("service.notice_publish_success"));
  }

  public async changePostPublish(name: string, publish: boolean): Promise<void> {
    await requestUrl({
      url: `${this.site.url}/apis/uc.api.content.halo.run/v1alpha1/posts/${name}/${publish ? "publish" : "unpublish"}`,
      method: "PUT",
      contentType: "application/json",
      headers: this.headers,
    });
  }

  private applyPostFrontmatter(
    post: Post,
    options: {
      activeFile: TFile;
      categoryNames?: string[];
      matterData?: HaloPostFrontmatter;
      tagNames?: string[];
      useActiveFileDefaults: boolean;
    },
  ): Post {
    const { activeFile, categoryNames, matterData, tagNames, useActiveFileDefaults } = options;
    const nextPost: Post = {
      ...post,
      metadata: {
        ...post.metadata,
        annotations: {
          ...post.metadata.annotations,
        },
      },
      spec: {
        ...post.spec,
        categories: [...(post.spec.categories || [])],
        excerpt: {
          ...post.spec.excerpt,
        },
        htmlMetas: [...(post.spec.htmlMetas || [])],
        tags: [...(post.spec.tags || [])],
      },
    };

    if (matterData?.title) {
      nextPost.spec.title = matterData.title;
    } else if (useActiveFileDefaults) {
      nextPost.spec.title = activeFile.basename;
    }

    if (matterData?.slug) {
      nextPost.spec.slug = matterData.slug;
    } else if (useActiveFileDefaults) {
      nextPost.spec.slug = slugify(nextPost.spec.title, { trim: true });
    }

    if (matterData?.excerpt) {
      nextPost.spec.excerpt.raw = matterData.excerpt;
      nextPost.spec.excerpt.autoGenerate = false;
    }

    if (matterData?.cover) {
      nextPost.spec.cover = matterData.cover;
    }

    if (categoryNames) {
      nextPost.spec.categories = categoryNames;
    }

    if (tagNames) {
      nextPost.spec.tags = tagNames;
    }

    return nextPost;
  }

  private createPostContent(raw: string, rawType = "markdown"): Content {
    return {
      content: markdownIt.render(raw),
      raw,
      rawType,
    };
  }

  private async withPublishRetry<T>(operation: () => Promise<T>): Promise<T> {
    for (let retryCount = 0; ; retryCount++) {
      try {
        return await operation();
      } catch (error) {
        if (retryCount >= PUBLISH_RETRY_COUNT) {
          throw error;
        }

        await this.sleep(PUBLISH_RETRY_DELAY_MS * (retryCount + 1));
      }
    }
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => {
      setTimeout(resolve, ms);
    });
  }

  public async getCategories(): Promise<Category[]> {
    const data = await requestUrl({
      url: `${this.site.url}/apis/content.halo.run/v1alpha1/categories`,
      headers: this.headers,
    });
    return Promise.resolve(data.json.items);
  }

  public async getTags(): Promise<Tag[]> {
    const data = await requestUrl({
      url: `${this.site.url}/apis/content.halo.run/v1alpha1/tags`,
      headers: this.headers,
    });
    return Promise.resolve(data.json.items);
  }

  public async updatePost(): Promise<void> {
    const { activeEditor } = this.app.workspace;

    if (!activeEditor || !activeEditor.file) {
      return;
    }

    const matterData = this.app.metadataCache.getFileCache(activeEditor.file)?.frontmatter;

    if (!matterData?.halo?.name) {
      new Notice(i18next.t("service.error_not_published"));
      return;
    }

    const post = await this.getPost(matterData.halo.name);

    if (!post) {
      new Notice(i18next.t("service.error_post_not_found"));
      return;
    }

    const postCategories = await this.getCategoryDisplayNames(post.post.spec.categories);
    const postTags = await this.getTagDisplayNames(post.post.spec.tags);

    await this.app.vault.modify(activeEditor.file, `${post.content.raw}`);

    this.app.fileManager.processFrontMatter(activeEditor.file, (frontmatter) => {
      frontmatter.title = post.post.spec.title;
      frontmatter.slug = post.post.spec.slug;
      frontmatter.cover = post.post.spec.cover;
      frontmatter.excerpt = post.post.spec.excerpt.autoGenerate ? undefined : post.post.spec.excerpt.raw;
      frontmatter.categories = postCategories;
      frontmatter.tags = postTags;
      frontmatter.halo = {
        site: this.site.url,
        name: post.post.metadata.name,
        publish: post.post.spec.publish,
      };
    });
  }

  public async pullPost(name: string): Promise<void> {
    const post = await this.getPost(name);

    if (!post) {
      new Notice(i18next.t("service.error_post_not_found"));
      return;
    }

    const postCategories = await this.getCategoryDisplayNames(post.post.spec.categories);
    const postTags = await this.getTagDisplayNames(post.post.spec.tags);

    const file = await this.app.vault.create(`${post.post.spec.title}.md`, `${post.content.raw}`);
    this.app.workspace.getLeaf().openFile(file);

    this.app.fileManager.processFrontMatter(file, (frontmatter) => {
      frontmatter.title = post.post.spec.title;
      frontmatter.slug = post.post.spec.slug;
      frontmatter.cover = post.post.spec.cover;
      frontmatter.excerpt = post.post.spec.excerpt.autoGenerate ? undefined : post.post.spec.excerpt.raw;
      frontmatter.categories = postCategories;
      frontmatter.tags = postTags;
      frontmatter.halo = {
        site: this.site.url,
        name: name,
        publish: post.post.spec.publish,
      };
    });
  }

  public async uploadImages(
    options: { silent?: boolean; replaceMarkdown?: boolean } = {},
  ): Promise<UploadImagesResult> {
    const { activeEditor } = this.app.workspace;

    if (!activeEditor || !activeEditor.file) {
      return {
        processedCount: 0,
        uploadedCount: 0,
        reusedCount: 0,
        failedCount: 0,
        replaced: false,
      };
    }

    const md = await this.app.vault.read(activeEditor.file);
    const imageReferences = this.collectLocalImageReferences(md, activeEditor.file);
    const replaceMarkdown = options.replaceMarkdown ?? this.settings.replaceImageLinks;

    if (imageReferences.length === 0) {
      if (!options.silent) {
        new Notice(i18next.t("service.notice_no_images_to_upload"));
      }
      return {
        processedCount: 0,
        uploadedCount: 0,
        reusedCount: 0,
        failedCount: 0,
        markdown: md,
        replaced: false,
      };
    }

    const uploadedPermalinks = new Map<string, string>();
    const replacements: { start: number; end: number; value: string }[] = [];
    let uploadedCount = 0;
    let reusedCount = 0;
    let failedCount = 0;

    for (const imageReference of imageReferences) {
      try {
        let permalink = uploadedPermalinks.get(imageReference.file.path);

        if (!permalink) {
          permalink = this.getCachedImagePermalink(imageReference.file);

          if (permalink) {
            reusedCount++;
          } else {
            permalink = await this.uploadImage(imageReference.file);
            this.cacheImagePermalink(imageReference.file, permalink);
            uploadedCount++;
          }

          uploadedPermalinks.set(imageReference.file.path, permalink);
        }

        replacements.push({
          start: imageReference.start,
          end: imageReference.end,
          value: imageReference.replacement(permalink),
        });
      } catch (error) {
        console.error("Error uploading image:", error);
        failedCount++;
      }
    }

    const updatedMarkdown =
      replacements.length > 0
        ? replacements
            .sort((a, b) => b.start - a.start)
            .reduce((markdown, replacement) => {
              return markdown.slice(0, replacement.start) + replacement.value + markdown.slice(replacement.end);
            }, md)
        : md;

    const shouldReplaceMarkdown = replaceMarkdown && failedCount === 0 && updatedMarkdown !== md;

    if (shouldReplaceMarkdown) {
      await this.app.vault.modify(activeEditor.file, updatedMarkdown);
    }

    if (!options.silent) {
      if (failedCount > 0) {
        new Notice(
          i18next.t("service.notice_upload_images_partial", { count: replacements.length, failed: failedCount }),
        );
      } else {
        new Notice(i18next.t("service.notice_upload_images_success", { count: replacements.length }));
      }
    }

    return {
      processedCount: replacements.length,
      uploadedCount,
      reusedCount,
      failedCount,
      markdown: updatedMarkdown,
      replaced: shouldReplaceMarkdown,
    };
  }

  public async uploadImage(file: TFile): Promise<string> {
    const fileData = await this.app.vault.readBinary(file);
    const body = this.createMultipartBody(file.name, file.extension, fileData);
    const attachment = (await requestUrl({
      url: `${this.site.url}/apis/uc.api.storage.halo.run/v1alpha1/attachments/-/upload`,
      method: "POST",
      contentType: body.contentType,
      headers: this.authHeaders,
      body: body.data,
    }).json) as Attachment;

    const permalink = attachment.status?.permalink;

    if (!permalink) {
      throw new Error("Halo attachment response has no permalink");
    }

    if (permalink.startsWith("http://") || permalink.startsWith("https://")) {
      return permalink;
    }

    return `${this.site.url}${permalink}`;
  }

  private getCachedImagePermalink(file: TFile): string | undefined {
    const cacheEntry = this.settings.imageUploadCache[this.site.url]?.[file.path];

    if (!cacheEntry || !this.isSameImageFile(file, cacheEntry)) {
      return undefined;
    }

    return cacheEntry.permalink;
  }

  private cacheImagePermalink(file: TFile, permalink: string): void {
    const siteCache = this.settings.imageUploadCache[this.site.url] ?? {};
    siteCache[file.path] = {
      filePath: file.path,
      size: file.stat.size,
      mtime: file.stat.mtime,
      permalink,
      updatedAt: Date.now(),
    };
    this.settings.imageUploadCache[this.site.url] = siteCache;
  }

  private isSameImageFile(file: TFile, cacheEntry: ImageUploadCacheEntry): boolean {
    return cacheEntry.size === file.stat.size && cacheEntry.mtime === file.stat.mtime;
  }

  public async getCategoryNames(displayNames: string[]): Promise<string[]> {
    const allCategories = await this.getCategories();

    const notExistDisplayNames = displayNames.filter(
      (name) => !allCategories.find((item) => item.spec.displayName === name),
    );

    const promises = notExistDisplayNames.map((name, index) =>
      requestUrl({
        url: `${this.site.url}/apis/content.halo.run/v1alpha1/categories`,
        method: "POST",
        contentType: "application/json",
        headers: this.headers,
        body: JSON.stringify({
          spec: {
            displayName: name,
            slug: slugify(name, { trim: true }),
            description: "",
            cover: "",
            template: "",
            priority: allCategories.length + index,
            children: [],
          },
          apiVersion: "content.halo.run/v1alpha1",
          kind: "Category",
          metadata: { name: "", generateName: "category-" },
        }),
      }),
    );

    const newCategories = await Promise.all(promises);

    const existNames = displayNames
      .map((name) => {
        const found = allCategories.find((item) => item.spec.displayName === name);
        return found ? found.metadata.name : undefined;
      })
      .filter(Boolean) as string[];

    return [...existNames, ...newCategories.map((item) => item.json.metadata.name)];
  }

  public async getCategoryDisplayNames(names?: string[]): Promise<string[]> {
    const categories = await this.getCategories();
    return names
      ?.map((name) => {
        const found = categories.find((item) => item.metadata.name === name);
        return found ? found.spec.displayName : undefined;
      })
      .filter(Boolean) as string[];
  }

  public async getTagNames(displayNames: string[]): Promise<string[]> {
    const allTags = await this.getTags();

    const notExistDisplayNames = displayNames.filter((name) => !allTags.find((item) => item.spec.displayName === name));

    const promises = notExistDisplayNames.map((name) =>
      requestUrl({
        url: `${this.site.url}/apis/content.halo.run/v1alpha1/tags`,
        method: "POST",
        contentType: "application/json",
        headers: this.headers,
        body: JSON.stringify({
          spec: {
            displayName: name,
            slug: slugify(name, { trim: true }),
            color: "#ffffff",
            cover: "",
          },
          apiVersion: "content.halo.run/v1alpha1",
          kind: "Tag",
          metadata: { name: "", generateName: "tag-" },
        }),
      }),
    );

    const newTags = await Promise.all(promises);

    const existNames = displayNames
      .map((name) => {
        const found = allTags.find((item) => item.spec.displayName === name);
        return found ? found.metadata.name : undefined;
      })
      .filter(Boolean) as string[];

    return [...existNames, ...newTags.map((item) => item.json.metadata.name)];
  }

  public async getTagDisplayNames(names?: string[]): Promise<string[]> {
    const tags = await this.getTags();
    return names
      ?.map((name) => {
        const found = tags.find((item) => item.metadata.name === name);
        return found ? found.spec.displayName : undefined;
      })
      .filter(Boolean) as string[];
  }

  private collectLocalImageReferences(markdown: string, sourceFile: TFile): LocalImageReference[] {
    const references: LocalImageReference[] = [];
    const markdownImageRegex = /!\[[^\]\n]*\]\(([^)\n]+)\)/g;
    const wikiEmbedRegex = /!\[\[([^\]\n]+)\]\]/g;

    let match = markdownImageRegex.exec(markdown);

    while (match !== null) {
      const target = this.parseMarkdownImageTarget(match[1]);

      if (!target || this.isRemotePath(target.path)) {
        match = markdownImageRegex.exec(markdown);
        continue;
      }

      const file = this.resolveImageFile(target.path, sourceFile);

      if (!file) {
        match = markdownImageRegex.exec(markdown);
        continue;
      }

      const targetOffset = match[0].indexOf(match[1]) + target.start;

      references.push({
        file,
        start: match.index + targetOffset,
        end: match.index + targetOffset + target.rawPath.length,
        replacement: (permalink) => permalink,
      });

      match = markdownImageRegex.exec(markdown);
    }

    match = wikiEmbedRegex.exec(markdown);

    while (match !== null) {
      const linkText = match[1].trim();
      const linkPath = this.decodeMarkdownPath(getLinkpath(linkText));

      if (this.isRemotePath(linkPath)) {
        match = wikiEmbedRegex.exec(markdown);
        continue;
      }

      const file = this.resolveImageFile(linkPath, sourceFile);

      if (!file) {
        match = wikiEmbedRegex.exec(markdown);
        continue;
      }

      references.push({
        file,
        start: match.index,
        end: match.index + match[0].length,
        replacement: (permalink) => `![${this.getWikiImageAlt(linkText)}](${permalink})`,
      });

      match = wikiEmbedRegex.exec(markdown);
    }

    return references;
  }

  private parseMarkdownImageTarget(rawTarget: string): MarkdownImageTarget | undefined {
    const trimmedStart = rawTarget.search(/\S/);

    if (trimmedStart === -1) {
      return undefined;
    }

    const trimmed = rawTarget.trim();

    if (trimmed.startsWith("<")) {
      const end = trimmed.indexOf(">");

      if (end <= 1) {
        return undefined;
      }

      const rawPath = trimmed.slice(1, end);
      return {
        rawPath,
        path: this.decodeMarkdownPath(rawPath),
        start: trimmedStart + 1,
      };
    }

    return {
      rawPath: trimmed,
      path: this.decodeMarkdownPath(trimmed),
      start: trimmedStart,
    };
  }

  private decodeMarkdownPath(path: string): string {
    try {
      return decodeURIComponent(path);
    } catch {
      return path;
    }
  }

  private resolveImageFile(path: string, sourceFile: TFile): TFile | undefined {
    const linkPath = getLinkpath(path);
    const linkDestination = this.app.metadataCache.getFirstLinkpathDest(linkPath, sourceFile.path);

    if (linkDestination && this.isImageFile(linkDestination)) {
      return linkDestination;
    }

    const normalizedPath = normalizePath(linkPath.replace(/^\/+/, ""));
    const absoluteFile = this.app.vault.getAbstractFileByPath(normalizedPath);

    if (absoluteFile instanceof TFile && this.isImageFile(absoluteFile)) {
      return absoluteFile;
    }

    const sourceDirectory = sourceFile.parent?.path || "";
    const relativePath = normalizePath(`${sourceDirectory}/${linkPath}`);
    const relativeFile = this.app.vault.getAbstractFileByPath(relativePath);

    if (relativeFile instanceof TFile && this.isImageFile(relativeFile)) {
      return relativeFile;
    }

    return undefined;
  }

  private isImageFile(file: TFile): boolean {
    return IMAGE_EXTENSIONS.has(file.extension.toLowerCase());
  }

  private isRemotePath(path: string): boolean {
    return /^[a-z][a-z0-9+.-]*:/i.test(path) || path.startsWith("//") || path.startsWith("#");
  }

  private getWikiImageAlt(linkText: string): string {
    const alias = linkText.split("|").slice(1).join("|").trim();

    if (!alias || /^\d+(x\d+)?$/.test(alias)) {
      return "";
    }

    return alias.replace(/]/g, "\\]");
  }

  private createMultipartBody(
    filename: string,
    extension: string,
    fileData: ArrayBuffer,
  ): { contentType: string; data: ArrayBuffer } {
    const boundary = `----obsidian-halo-${randomUUID()}`;
    const mimeType = IMAGE_MIME_TYPES[extension.toLowerCase()] || "application/octet-stream";
    const safeFilename = filename.replace(/["\r\n]/g, "_");
    const encoder = new TextEncoder();
    const header = encoder.encode(
      `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${safeFilename}"\r\nContent-Type: ${mimeType}\r\n\r\n`,
    );
    const footer = encoder.encode(`\r\n--${boundary}--\r\n`);
    const body = new Uint8Array(header.length + fileData.byteLength + footer.length);

    body.set(header, 0);
    body.set(new Uint8Array(fileData), header.length);
    body.set(footer, header.length + fileData.byteLength);

    return {
      contentType: `multipart/form-data; boundary=${boundary}`,
      data: body.buffer,
    };
  }
}

export default HaloService;
