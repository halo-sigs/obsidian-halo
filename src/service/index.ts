import { Category, PostRequest, Tag } from "@halo-dev/api-client";
import { Notice, requestUrl } from "obsidian";
import { HaloSite } from "../settings";
import MarkdownIt from "markdown-it";
import { randomUUID } from "crypto";
import { readMatter, mergeMatter } from "../utils/yaml";
import { slugify } from "transliteration";

class HaloService {
  private readonly site: HaloSite;
  private readonly headers: Record<string, string> = {};

  constructor(site: HaloSite) {
    this.site = site;

    this.headers = {
      "Content-Type": "application/json",
      Authorization: `Basic ${Buffer.from(`${site.username}:${site.password}`).toString("base64")}`,
    };
  }

  public async getPost(name: string): Promise<PostRequest | undefined> {
    try {
      const post = await requestUrl({
        url: `${this.site.url}/apis/content.halo.run/v1alpha1/posts/${name}`,
        headers: this.headers,
      });

      const content = await requestUrl({
        url: `${this.site.url}/apis/api.console.halo.run/v1alpha1/posts/${name}/head-content`,
        headers: this.headers,
      });

      return Promise.resolve({
        post: post.json,
        content: content.json,
      });
    } catch (error) {
      return Promise.resolve(undefined);
    }
  }

  public async publishPost(): Promise<void> {
    const { activeEditor } = app.workspace;

    if (!activeEditor || !activeEditor.file) {
      return;
    }

    let requestParams: PostRequest = {
      post: {
        spec: {
          title: "",
          slug: "",
          template: "",
          cover: "",
          deleted: false,
          publish: false,
          publishTime: undefined,
          pinned: false,
          allowComment: true,
          visible: "PUBLIC",
          priority: 0,
          excerpt: {
            autoGenerate: true,
            raw: "",
          },
          categories: [],
          tags: [],
          htmlMetas: [],
        },
        apiVersion: "content.halo.run/v1alpha1",
        kind: "Post",
        metadata: {
          name: "",
          annotations: {},
        },
      },
      content: {
        raw: "",
        content: "",
        rawType: "markdown",
      },
    };

    const contentWithMatter = await app.vault.read(activeEditor.file);
    const { content: raw, data: matterData } = readMatter(contentWithMatter);

    if (matterData.halo?.name) {
      const post = await this.getPost(matterData.halo.name);
      requestParams = post ? post : requestParams;
    }

    requestParams.content.raw = raw;
    requestParams.content.content = new MarkdownIt({
      html: true,
      xhtmlOut: true,
      breaks: true,
      linkify: true,
      typographer: true,
    }).render(raw);

    if (requestParams.post.metadata.name) {
      await requestUrl({
        url: `${this.site.url}/apis/api.console.halo.run/v1alpha1/posts/${requestParams.post.metadata.name}/content`,
        method: "PUT",
        contentType: "application/json",
        headers: this.headers,
        body: JSON.stringify(requestParams.content),
      });
    } else {
      requestParams.post.metadata.name = randomUUID();
      requestParams.post.spec.title = activeEditor.file.basename;
      requestParams.post.spec.slug = randomUUID();

      const post = await requestUrl({
        url: `${this.site.url}/apis/api.console.halo.run/v1alpha1/posts`,
        method: "POST",
        contentType: "application/json",
        headers: this.headers,
        body: JSON.stringify(requestParams),
      }).json;

      requestParams.post = post;
    }

    await requestUrl({
      url: `${this.site.url}/apis/api.console.halo.run/v1alpha1/posts/${requestParams.post.metadata.name}/publish`,
      method: "PUT",
      contentType: "application/json",
      headers: this.headers,
    }).json;

    const modifiedContent = mergeMatter(raw, {
      ...matterData,
      halo: { site: this.site.url, name: requestParams.post.metadata.name },
    });

    const editor = activeEditor.editor;
    if (editor) {
      const { left, top } = editor.getScrollInfo();
      const position = editor.getCursor();

      editor.setValue(modifiedContent);
      editor.scrollTo(left, top);
      editor.setCursor(position);
    }

    new Notice("发布成功");
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
    const { activeEditor } = app.workspace;

    if (!activeEditor || !activeEditor.file) {
      return;
    }

    const contentWithMatter = await app.vault.read(activeEditor.file);
    const { data: matterData } = readMatter(contentWithMatter);

    if (!matterData.halo?.name) {
      new Notice("此文档还未发布到 Halo");
      return;
    }

    const post = await this.getPost(matterData.halo.name);

    const editor = activeEditor.editor;

    const modifiedContent = mergeMatter(post?.content.raw as string, {
      ...matterData,
      halo: { site: this.site.url, name: matterData.halo.name },
    });

    if (editor) {
      const { left, top } = editor.getScrollInfo();
      const position = editor.getCursor();

      editor.setValue(modifiedContent);
      editor.scrollTo(left, top);
      editor.setCursor(position);

      new Notice("更新成功");
    }
  }

  public async pullPost(name: string): Promise<void> {
    const post = await this.getPost(name);

    if (!post) {
      new Notice("文章不存在");
      return;
    }

    const postCategories = await this.getCategoryDisplayNames(post.post.spec.categories);
    const postTags = await this.getTagDisplayNames(post.post.spec.tags);

    const modifiedContent = mergeMatter(post.content.raw as string, {
      title: post.post.spec.title,
      categories: postCategories,
      tags: postTags,
      halo: {
        site: this.site.url,
        name: name,
        publish: post.post.spec.publish,
      },
    });

    console.log(modifiedContent);

    const file = await app.vault.create(`${post.post.spec.title}.md`, modifiedContent);

    app.workspace.getLeaf().openFile(file);
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
