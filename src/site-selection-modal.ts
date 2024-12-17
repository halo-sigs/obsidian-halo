import i18next from "i18next";
import { Modal, Setting } from "obsidian";
import type HaloPlugin from "./main";
import type { HaloSite } from "./settings";

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

  constructor(
    private readonly plugin: HaloPlugin,
    private readonly onSelect: (site: HaloSite) => void,
  ) {
    super(app);

    this.sites = plugin.settings.sites;
  }

  onOpen() {
    const { contentEl } = this;

    const renderContent = (): void => {
      contentEl.empty();

      contentEl.createEl("h2", {
        text: i18next.t("site_selection_modal.title"),
      });

      for (const site of this.sites) {
        const setting = new Setting(contentEl).setName(site.name).setDesc(site.url);

        setting.addButton((button) =>
          button.setButtonText(i18next.t("site_selection_modal.button_choose")).onClick(() => {
            this.onSelect(site);
            this.close();
          }),
        );
      }

      new Setting(contentEl).addButton((button) =>
        button.setButtonText(i18next.t("common.button_close")).onClick(() => this.close()),
      );
    };

    renderContent();
  }

  onClose() {
    const { contentEl } = this;
    contentEl.empty();
  }
}
