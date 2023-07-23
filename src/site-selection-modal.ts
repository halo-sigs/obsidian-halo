import { Modal, Setting } from "obsidian";
import HaloPlugin from "./main";
import { HaloSite } from "./settings";

export function openSiteSelectionModal(plugin: HaloPlugin): Promise<HaloSite> {
  return new Promise<HaloSite>((resolve, reject) => {
    const modal = new SiteSelectionModal(plugin, (site) => {
      resolve(site);
    });
    modal.open();
  });
}

class SiteSelectionModal extends Modal {
  private readonly sites: HaloSite[];

  constructor(private readonly plugin: HaloPlugin, private readonly onSelect: (site: HaloSite) => void) {
    super(app);

    this.sites = plugin.settings.sites;
  }

  onOpen() {
    const { contentEl } = this;

    const renderContent = (): void => {
      contentEl.empty();

      contentEl.createEl("h2", { text: "选择一个 Halo 站点" });

      this.sites.forEach((site) => {
        const setting = new Setting(contentEl).setName(site.name).setDesc(site.url);

        setting.addButton((button) =>
          button.setButtonText("选择").onClick(() => {
            this.onSelect(site);
            this.close();
          })
        );
      });

      new Setting(contentEl).addButton((button) => button.setButtonText("关闭").onClick(() => this.close()));
    };

    renderContent();
  }

  onClose() {
    const { contentEl } = this;
    contentEl.empty();
  }
}
