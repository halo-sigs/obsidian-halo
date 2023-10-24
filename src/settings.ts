import { PluginSettingTab, Setting } from "obsidian";
import HaloPlugin from "./main";
import { HaloSitesModal } from "./sites-modal";

export interface HaloSite {
  name: string;
  url: string;
  token: string;
  default: boolean;
}

export interface HaloSetting {
  sites: HaloSite[];
}

export const DEFAULT_SETTINGS: HaloSetting = {
  sites: [],
};

export class HaloSettingTab extends PluginSettingTab {
  constructor(private readonly plugin: HaloPlugin) {
    super(app, plugin);
  }

  display() {
    const { containerEl } = this;

    containerEl.empty();

    containerEl.createEl("h2", { text: "Halo 发布设置" });

    new Setting(containerEl)
      .setName("Halo 站点")
      .setDesc("Halo 站点管理，支持设置多个")
      .addButton((button) =>
        button.setButtonText("打开").onClick(() => {
          new HaloSitesModal(this.plugin).open();
        }),
      );
  }
}
