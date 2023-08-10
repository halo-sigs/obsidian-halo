import { Notice, Plugin } from "obsidian";
import { addHaloIcon } from "./icons";
import { HaloSettingTab, HaloSetting, DEFAULT_SETTINGS } from "./settings";
import { readMatter } from "./utils/yaml";
import { openSiteSelectionModal } from "./site-selection-modal";
import { openPostSelectionModal } from "./post-selection-model";
import HaloService from "./service";

export default class HaloPlugin extends Plugin {
  settings: HaloSetting;

  async onload() {
    console.log("loading obsidian-halo plugin");

    await this.loadSettings();

    addHaloIcon();

    this.addRibbonIcon("halo-logo", "Publish to Halo", (evt: MouseEvent) => {
      new Notice("This is a notice!");
    });

    this.addCommand({
      id: "halo-publish",
      name: "Publish to Halo",
      callback: async () => {
        const site = this.settings.sites[0];
        const service = new HaloService(site);
        await service.publishPost();
      },
    });

    this.addCommand({
      id: "halo-publish-with-defaults",
      name: "Publish to Halo(with defaults)",
      callback: async () => {
        const site = this.settings.sites.find((site) => site.default);

        if (!site) {
          new Notice("请先配置默认站点");
          return;
        }

        const service = new HaloService(site);
        await service.publishPost();
      },
    });

    this.addCommand({
      id: "halo-update-post",
      name: "Update post from Halo",
      editorCallback: async () => {
        const { activeEditor } = app.workspace;

        if (!activeEditor || !activeEditor.file) {
          return;
        }

        const contentWithMatter = await app.vault.read(activeEditor.file);
        const { data: matterData } = readMatter(contentWithMatter);

        if (!matterData.halo?.site) {
          new Notice("此文档还未发布到 Halo");
          return;
        }

        const site = this.settings.sites.find((site) => site.url === matterData.halo?.site);

        if (!site) {
          new Notice("此文档发布到的站点未配置");
          return;
        }

        const service = new HaloService(site);
        await service.updatePost();
      },
    });

    this.addCommand({
      id: "halo-pull-post",
      name: "Pull post from Halo",
      callback: async () => {
        const site = await openSiteSelectionModal(this);

        const post = await openPostSelectionModal(this, site);

        console.log(post);

        const service = new HaloService(site);
        await service.pullPost(post.post.metadata.name);
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
