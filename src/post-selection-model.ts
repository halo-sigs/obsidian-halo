import { Modal, Notice, Setting, requestUrl } from "obsidian";
import HaloPlugin from "./main";
import { ListedPost } from "@halo-dev/api-client";
import { HaloSite } from "./settings";

export function openPostSelectionModal(plugin: HaloPlugin, site: HaloSite): Promise<ListedPost> {
  return new Promise<ListedPost>((resolve, reject) => {
    const modal = new PostSelectionModal(plugin, site, (post) => {
      resolve(post);
    });
    modal.open();
  });
}

class PostSelectionModal extends Modal {
  constructor(
    private readonly plugin: HaloPlugin,
    private readonly site: HaloSite,
    private readonly onSelect: (post: ListedPost) => void,
  ) {
    super(app);
  }

  onOpen() {
    const { contentEl } = this;

    const renderPostList = (): void => {
      contentEl.empty();

      contentEl.createEl("h2", { text: "选择一篇 Halo 文章" });

      requestUrl({
        url: `${this.site.url}/apis/api.console.halo.run/v1alpha1/posts`,
        headers: {
          Authorization: `Basic ${Buffer.from(`${this.site.username}:${this.site.password}`).toString("base64")}`,
        },
      })
        .then((response) => {
          const posts: ListedPost[] = response.json.items;

          posts.forEach((post) => {
            const setting = new Setting(contentEl)
              .setName(post.post.spec.title)
              .setDesc(post.post.status?.permalink + "");

            setting.addButton((button) =>
              button.setButtonText("选择").onClick(() => {
                this.onSelect(post);
                this.close();
              }),
            );
          });
        })
        .catch(() => {
          new Notice("连接失败");
        });

      new Setting(contentEl).addButton((button) => button.setButtonText("关闭").onClick(() => this.close()));
    };

    renderPostList();
  }

  onClose() {
    const { contentEl } = this;
    contentEl.empty();
  }
}
