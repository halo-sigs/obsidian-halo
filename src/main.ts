import { Notice, Plugin } from "obsidian";
import { addHaloIcon } from "./icons";
import { HaloSettingTab, HaloSetting, DEFAULT_SETTINGS, HaloSite } from "./settings";
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

    this.addRibbonIcon("halo-logo", "发布当前文档到 Halo", async (evt: MouseEvent) => {
      await this.publishCommand();
    });

    this.addCommand({
      id: "halo-publish",
      name: "发布到 Halo",
      callback: async () => {
        await this.publishCommand();
      },
    });

    this.addCommand({
      id: "halo-publish-with-defaults",
      name: "发布到 Halo（使用默认配置）",
      callback: async () => {
        const site = this.settings.sites.find((site) => site.default);

        if (!site) {
          new Notice("请先配置默认站点");
          return;
        }

        const service = new HaloService(this.app, site);
        await service.publishPost();
      },
    });

    this.addCommand({
      id: "halo-update-post",
      name: "从 Halo 更新内容",
      editorCallback: async () => {
        const { activeEditor } = this.app.workspace;

        if (!activeEditor || !activeEditor.file) {
          return;
        }

        const contentWithMatter = await this.app.vault.read(activeEditor.file);
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

        const service = new HaloService(this.app, site);
        await service.updatePost();

        new Notice("已更新");
      },
    });

    this.addCommand({
      id: "halo-pull-post",
      name: "从 Halo 拉取文档",
      callback: async () => {
        if (this.settings.sites.length === 0) {
          new Notice("请先配置站点");
          return;
        }

        let site: HaloSite = this.settings.sites[0];

        if (this.settings.sites.length > 1) {
          site = await openSiteSelectionModal(this);
        }

        const post = await openPostSelectionModal(this, site);

        const service = new HaloService(this.app, site);
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

  private async publishCommand() {
    const { activeEditor } = this.app.workspace;

    if (!activeEditor || !activeEditor.file) {
      return;
    }

    const { data: matterData } = readMatter(await this.app.vault.read(activeEditor.file));

    if (matterData.halo?.site) {
      const site = this.settings.sites.find((site) => site.url === matterData.halo.site);

      if (!site) {
        new Notice("此文档发布到的站点未配置");
        return;
      }

      const service = new HaloService(this.app, site);
      await service.publishPost();
      return;
    }

    const site = await openSiteSelectionModal(this);
    const service = new HaloService(this.app, site);
    await service.publishPost();
  }
}
