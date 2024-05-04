import { Modal, Notice, Setting, requestUrl } from "obsidian";
import HaloPlugin from "./main";
import { ListedPost } from "@halo-dev/api-client";
import { HaloSite } from "./settings";
import i18next from "i18next";

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

      contentEl.createEl("h2", { text: i18next.t("post_selection_modal.title") });

      requestUrl({
        url: `${this.site.url}/apis/uc.api.content.halo.run/v1alpha1/posts?labelSelector=content.halo.run%2Fdeleted%3Dfalse`,
        headers: {
          Authorization: `Bearer ${this.site.token}`,
        },
      })
        .then((response) => {
          const posts: ListedPost[] = response.json.items;

          posts.forEach((post) => {
            const setting = new Setting(contentEl).setName(post.post.spec.title).setDesc(post.post.spec.slug);

            setting.addButton((button) =>
              button.setButtonText(i18next.t("post_selection_modal.button_pull")).onClick(() => {
                this.onSelect(post);
                this.close();
              }),
            );
          });
        })
        .catch(() => {
          new Notice(i18next.t("common.error_connection_failed"));
        })
        .finally(() => {
          new Setting(contentEl).addButton((button) =>
            button.setButtonText(i18next.t("common.button_close")).onClick(() => this.close()),
          );
        });
    };

    renderPostList();
  }

  onClose() {
    const { contentEl } = this;
    contentEl.empty();
  }
}
