import { PluginSettingTab, Setting } from "obsidian";
import HaloPlugin from "./main";
import { HaloSitesModal } from "./sites-modal";
import i18next from "i18next";

export interface HaloSite {
  name: string;
  url: string;
  token: string;
  default: boolean;
}

export interface HaloSetting {
  sites: HaloSite[];
  publishByDefault: boolean;
}

export const DEFAULT_SETTINGS: HaloSetting = {
  sites: [],
  publishByDefault: false,
};

export class HaloSettingTab extends PluginSettingTab {
  constructor(private readonly plugin: HaloPlugin) {
    super(app, plugin);
  }

  display() {
    const { containerEl } = this;

    containerEl.empty();

    new Setting(containerEl)
      .setName(i18next.t("settings.site.name"))
      .setDesc(i18next.t("settings.site.description"))
      .addButton((button) =>
        button.setButtonText(i18next.t("settings.site.actions.open")).onClick(() => {
          new HaloSitesModal(this.plugin).open();
        }),
      );

    new Setting(containerEl)
      .setName(i18next.t("settings.publishByDefault.name"))
      .setDesc(i18next.t("settings.publishByDefault.description"))
      .addToggle((toggle) => {
        toggle.setValue(this.plugin.settings.publishByDefault).onChange((value) => {
          this.plugin.settings.publishByDefault = value;
          this.plugin.saveSettings();
        });
      });
  }
}
