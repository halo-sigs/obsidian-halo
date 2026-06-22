import type { Attachment, Category, Content, Post, Snapshot, Tag } from "@halo-dev/api-client";
import i18next from "i18next";
import { type App, Notice, TFile, getLinkpath, normalizePath, requestUrl } from "obsidian";
import { randomUUID } from "src/utils/id";
import markdownIt from "src/utils/markdown";
import { slugify } from "transliteration";
import type { HaloSetting, HaloSite } from "../settings";

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

const IMAGE_EXTENSIONS = new Set(["avif", "bmp", "gif", "ico", "jpeg", "jpg", "png", "svg", "tif", "tiff", "webp"]);

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
    this.site = site;

    this.authHeaders = {
      Authorization: `Bearer ${site.token}`,
    };

    this.headers = {
      "Content-Type": "application/json",
      ...this.authHeaders,
    };
  }

  public async getPost(name: string): Promise<{ post: Post; content: Content } | undefined> {
    try {
      const post = (await requestUrl({
        url: `${this.site.url}/apis/uc.api.content.halo.run/v1alpha1/posts/${name}`,
        headers: this.headers,
      }).json) as Post;

      const snapshot = (await requestUrl({
        url: `${this.site.url}/apis/uc.api.content.halo.run/v1alpha1/posts/${name}/draft?patched=true`,
        headers: this.headers,
      }).json) as Snapshot;

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

  public async publishPost(): Promise<void> {
    const { activeEditor } = this.app.workspace;

    if (!activeEditor || !activeEditor.file) {
      return;
    }

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

    let content: Content = {
      rawType: "markdown",
      raw: "",
      content: "",
    };

    const md = await this.app.vault.read(activeEditor.file);
    const matterData = this.app.metadataCache.getFileCache(activeEditor.file)?.frontmatter;
    const frontmatterPosition = this.app.metadataCache.getFileCache(activeEditor.file)?.frontmatterPosition;

    const raw = frontmatterPosition ? md.slice(frontmatterPosition?.end.offset) : md;

    // check site url
    if (matterData?.halo?.site && matterData.halo.site !== this.site.url) {
      new Notice(i18next.t("service.error_site_not_match"));
      return;
    }

    if (matterData?.halo?.name) {
      const post = await this.getPost(matterData.halo.name);

      if (post) {
        params = post.post;
        content = post.content;
      }
    }

    content.raw = raw;
    content.content = markdownIt.render(raw);

    // restore metadata
    if (matterData?.title) {
      params.spec.title = matterData.title;
    }

    if (matterData?.slug) {
      params.spec.slug = matterData.slug;
    }

    if (matterData?.excerpt) {
      params.spec.excerpt.raw = matterData.excerpt;
      params.spec.excerpt.autoGenerate = false;
    }

    if (matterData?.cover) {
      params.spec.cover = matterData.cover;
    }

    if (matterData?.categories) {
      const categoryNames = await this.getCategoryNames(matterData.categories);
      params.spec.categories = categoryNames;
    }

    if (matterData?.tags) {
      const tagNames = await this.getTagNames(matterData.tags);
      params.spec.tags = tagNames;
    }

    try {
      if (params.metadata.name) {
        const { name } = params.metadata;

        await requestUrl({
          url: `${this.site.url}/apis/uc.api.content.halo.run/v1alpha1/posts/${name}`,
          method: "PUT",
          contentType: "application/json",
          headers: this.headers,
          body: JSON.stringify(params),
        });

        const snapshot = (await requestUrl({
          url: `${this.site.url}/apis/uc.api.content.halo.run/v1alpha1/posts/${name}/draft?patched=true`,
          headers: this.headers,
        }).json) as Snapshot;

        snapshot.metadata.annotations = {
          ...snapshot.metadata.annotations,
          "content.halo.run/content-json": JSON.stringify(content),
        };

        await requestUrl({
          url: `${this.site.url}/apis/uc.api.content.halo.run/v1alpha1/posts/${name}/draft`,
          method: "PUT",
          contentType: "application/json",
          headers: this.headers,
          body: JSON.stringify(snapshot),
        });
      } else {
        params.metadata.name = randomUUID();
        params.spec.title = matterData?.title || activeEditor.file.basename;
        params.spec.slug = matterData?.slug || slugify(params.spec.title, { trim: true });

        params.metadata.annotations = {
          ...params.metadata.annotations,
          "content.halo.run/content-json": JSON.stringify(content),
        };

        const post = await requestUrl({
          url: `${this.site.url}/apis/uc.api.content.halo.run/v1alpha1/posts`,
          method: "POST",
          contentType: "application/json",
          headers: this.headers,
          body: JSON.stringify(params),
        }).json;

        params = post;
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

      params = (await this.getPost(params.metadata.name))?.post || params;
    } catch (error) {
      new Notice(i18next.t("service.error_publish_failed"));
      return;
    }

    const postCategories = await this.getCategoryDisplayNames(params.spec.categories);
    const postTags = await this.getTagDisplayNames(params.spec.tags);

    this.app.fileManager.processFrontMatter(activeEditor.file, (frontmatter) => {
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

  public async uploadImages(options: { silent?: boolean } = {}): Promise<number> {
    const { activeEditor } = this.app.workspace;

    if (!activeEditor || !activeEditor.file) {
      return 0;
    }

    const md = await this.app.vault.read(activeEditor.file);
    const imageReferences = this.collectLocalImageReferences(md, activeEditor.file);

    if (imageReferences.length === 0) {
      if (!options.silent) {
        new Notice(i18next.t("service.notice_no_images_to_upload"));
      }
      return 0;
    }

    const uploadedPermalinks = new Map<string, string>();
    const replacements: { start: number; end: number; value: string }[] = [];
    let failedCount = 0;

    for (const imageReference of imageReferences) {
      try {
        let permalink = uploadedPermalinks.get(imageReference.file.path);

        if (!permalink) {
          permalink = await this.uploadImage(imageReference.file);
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

    if (replacements.length > 0) {
      const updatedMarkdown = replacements
        .sort((a, b) => b.start - a.start)
        .reduce((markdown, replacement) => {
          return markdown.slice(0, replacement.start) + replacement.value + markdown.slice(replacement.end);
        }, md);

      if (updatedMarkdown !== md) {
        await this.app.vault.modify(activeEditor.file, updatedMarkdown);
      }
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

    return replacements.length;
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
