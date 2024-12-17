// biome-ignore format: no
import { randomUUID } from "node:crypto";
import type { Category, Content, Post, Snapshot, Tag } from "@halo-dev/api-client";
import i18next from "i18next";
import { type App, Notice, requestUrl } from "obsidian";
import markdownIt from "src/utils/markdown";
import { slugify } from "transliteration";
import type { HaloSetting, HaloSite } from "../settings";
import { readMatter } from "../utils/yaml";

class HaloService {
  private readonly site: HaloSite;
  private readonly app: App;
  private readonly settings: HaloSetting;
  private readonly headers: Record<string, string> = {};

  constructor(app: App, settings: HaloSetting, site: HaloSite) {
    this.app = app;
    this.settings = settings;
    this.site = site;

    this.headers = {
      "Content-Type": "application/json",
      Authorization: `Bearer ${site.token}`,
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

    const { content: raw } = readMatter(await this.app.vault.read(activeEditor.file));
    const matterData = this.app.metadataCache.getFileCache(activeEditor.file)?.frontmatter;

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
      if (matterData?.halo?.hasOwn("publish")) {
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
}

export default HaloService;
