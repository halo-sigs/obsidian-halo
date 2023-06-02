import { Notice, Plugin, requestUrl } from "obsidian";
import { addHaloIcon } from "./icons";
import { HaloSettingTab, HaloSetting, DEFAULT_SETTINGS } from "./settings";
import { HaloRestClient } from "./halo-rest-client";

export default class HaloPlugin extends Plugin {
  settings: HaloSetting;

  async onload() {
    console.log("loading obsidian-halo plugin");

    await this.loadSettings();

    addHaloIcon();

    requestUrl({
      url: "http://localhost:8090/apis/api.console.halo.run/v1alpha1/posts",
      headers: {
        Authorization: `Basic ${Buffer.from(`admin:admin`).toString("base64")}`,
      },
    }).then((response) => {
      console.log(response);
    });

    this.addRibbonIcon("halo-logo", "Publish to Halo", (evt: MouseEvent) => {
      new Notice("This is a notice!");
    });

    this.addCommand({
      id: "halo-publish",
      name: "Publish to Halo",
      editorCallback: async () => {
        const site = this.settings.sites[0];
        const client = new HaloRestClient(site);
        await client.publishPost();
      },
    });

    this.addCommand({
      id: "halo-publish-with-defaults",
      name: "Publish to Halo(with defaults)",
      callback() {
        new Notice("Hello");
      },
    });

    this.addSettingTab(new HaloSettingTab(this));
  }

  onunload() {}

  async loadSettings() {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
  }

  async saveSettings() {
    await this.saveData(this.settings);
  }
}
