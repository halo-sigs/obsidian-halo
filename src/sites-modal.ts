import i18next from "i18next";
import { Modal, Setting } from "obsidian";
import type HaloPlugin from "./main";
import { openSiteEditingModal } from "./site-editing-modal";

export class HaloSitesModal extends Modal {
  constructor(private readonly plugin: HaloPlugin) {
    super(app);
  }

  onOpen(): void {
    const { contentEl } = this;

    const renderContent = (): void => {
      contentEl.empty();

      contentEl.createEl("h2", { text: i18next.t("sites_modal.title") });

      this.plugin.settings.sites.forEach((site, index) => {
        const setting = new Setting(contentEl).setName(site.name).setDesc(site.url);

        if (!site.default) {
          setting.addButton((button) =>
            button.setButtonText(i18next.t("sites_modal.actions.set_default")).onClick(() => {
              for (const site of this.plugin.settings.sites) {
                site.default = false;
              }

              site.default = true;
              this.plugin.saveSettings();
              renderContent();
            }),
          );
        }

        setting.addButton((button) =>
          button.setButtonText(i18next.t("sites_modal.actions.edit")).onClick(async () => {
            const { site: updatedSite, index: currentIndex } = await openSiteEditingModal(this.plugin, site, index);

            if (currentIndex !== undefined && currentIndex > -1) {
              this.plugin.settings.sites[currentIndex] = updatedSite;
              await this.plugin.saveSettings();

              renderContent();
            }
          }),
        );
        setting.addExtraButton((button) =>
          button.setIcon("lucide-trash").onClick(() => {
            this.plugin.settings.sites.splice(index, 1);
            this.plugin.saveSettings();
            renderContent();
          }),
        );
      });

      new Setting(contentEl).addButton((button) =>
        button.setButtonText(i18next.t("sites_modal.actions.add")).onClick(async () => {
          const { site } = await openSiteEditingModal(this.plugin);

          if (this.plugin.settings.sites.length === 0) {
            site.default = true;
          }

          if (site.default) {
            for (const site of this.plugin.settings.sites) {
              site.default = false;
            }
          }

          this.plugin.settings.sites.push(site);
          await this.plugin.saveSettings();

          renderContent();
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
