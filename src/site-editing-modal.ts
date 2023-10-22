import { Modal, Setting, requestUrl, Notice } from "obsidian";
import HaloPlugin from "./main";
import { HaloSite } from "./settings";

export function openSiteEditingModal(
  plugin: HaloPlugin,
  site?: HaloSite,
  index = -1,
): Promise<{ site: HaloSite; index?: number }> {
  return new Promise((resolve, reject) => {
    const modal = new SiteEditingModal(plugin, site, index, (site, index) => {
      resolve({
        site,
        index,
      });
    });
    modal.open();
  });
}

export class SiteEditingModal extends Modal {
  private readonly currentSite: HaloSite;

  constructor(
    private readonly plugin: HaloPlugin,
    private readonly site: HaloSite = {
      name: "",
      url: "",
      token: "",
      default: false,
    },
    private readonly index: number = -1,
    private readonly onSubmit: (site: HaloSite, index?: number) => void,
  ) {
    super(app);

    this.currentSite = Object.assign({}, site);
  }
  onOpen(): void {
    const { contentEl } = this;

    const renderContent = () => {
      contentEl.empty();

      contentEl.createEl("h2", { text: "Halo 站点" });

      new Setting(contentEl)
        .setName("站点名称")
        .setDesc("Halo 的站点名称")
        .addText((text) =>
          text.setValue(this.currentSite.name).onChange((value) => {
            this.currentSite.name = value;
          }),
        );

      new Setting(contentEl)
        .setName("站点地址")
        .setDesc("Halo 的站点地址")
        .addText((text) =>
          text.setValue(this.currentSite.url).onChange((value) => {
            this.currentSite.url = value;
          }),
        );

      new Setting(contentEl)
        .setName("个人令牌")
        .setDesc("需要包含文章管理的相关权限")
        .addText((text) =>
          text.setValue(this.currentSite.token).onChange((value) => {
            this.currentSite.token = value;
          }),
        );

      new Setting(contentEl)
        .setName("是否设置为默认")
        .setDesc("设置为默认的发布站点")
        .addToggle((toggle) =>
          toggle.setValue(this.currentSite.default).onChange((value) => {
            this.currentSite.default = value;
          }),
        );

      new Setting(contentEl)
        .addButton((button) => {
          button.setButtonText("验证").onClick(() => {
            button.setDisabled(true);
            button.setButtonText("验证中...");
            requestUrl({
              url: `${this.currentSite.url}/apis/api.console.halo.run/v1alpha1/posts?page=1&size=1`,
              headers: {
                Authorization: `Bearer ${this.currentSite.token}`,
              },
            })
              .then(() => {
                new Notice("连接正常");
              })
              .catch(() => {
                new Notice("连接失败");
              })
              .finally(() => {
                button.setDisabled(false);
                button.setButtonText("验证");
              });
          });
        })
        .addButton((button) =>
          button
            .setButtonText("保存")
            .setCta()
            .onClick(() => {
              this.onSubmit(this.currentSite, this.index);
              this.close();
            }),
        );
    };

    renderContent();
  }

  onClose(): void {
    const { contentEl } = this;
    contentEl.empty();
  }
}
