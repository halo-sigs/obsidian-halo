import { Notice, Plugin, moment } from "obsidian";
import { addHaloIcon } from "./icons";
import { HaloSettingTab, HaloSetting, DEFAULT_SETTINGS, HaloSite } from "./settings";
import { openSiteSelectionModal } from "./site-selection-modal";
import { openPostSelectionModal } from "./post-selection-model";
import HaloService from "./service";
import i18next from "i18next";
import { resources } from "./i18n";

export default class HaloPlugin extends Plugin {
  settings: HaloSetting;

  async onload() {
    console.log("loading obsidian-halo plugin");

    await i18next.init({
      lng: moment.locale(),
      fallbackLng: "en",
      resources,
      returnNull: false,
    });

    await this.loadSettings();

    addHaloIcon();

    this.addRibbonIcon("halo-logo", i18next.t("ribbon_icon.publish"), async (evt: MouseEvent) => {
      await this.publishCommand();
    });

    this.addCommand({
      id: "publish",
      name: i18next.t("command.publish.name"),
      callback: async () => {
        await this.publishCommand();
      },
    });

    this.addCommand({
      id: "publish-with-defaults",
      name: i18next.t("command.publish_with_defaults.name"),
      callback: async () => {
        const site = this.settings.sites.find((site) => site.default);

        if (!site) {
          new Notice(i18next.t("command.publish_with_defaults.error_no_default_site"));
          return;
        }

        const service = new HaloService(this.app, site);
        await service.publishPost();
      },
    });

    this.addCommand({
      id: "update-post",
      name: i18next.t("command.update_post.name"),
      editorCallback: async () => {
        const { activeEditor } = this.app.workspace;

        if (!activeEditor || !activeEditor.file) {
          return;
        }

        const matterData = this.app.metadataCache.getFileCache(activeEditor.file)?.frontmatter;

        if (!matterData?.halo?.site) {
          new Notice(i18next.t("command.update_post.error_not_published"));
          return;
        }

        const site = this.settings.sites.find((site) => site.url === matterData.halo?.site);

        if (!site) {
          new Notice(i18next.t("command.update_post.error_no_matched_site"));
          return;
        }

        const service = new HaloService(this.app, site);

        await service.updatePost();

        new Notice(i18next.t("command.update_post.success"));
      },
    });

    this.addCommand({
      id: "pull-post",
      name: i18next.t("command.pull_post.name"),
      callback: async () => {
        if (this.settings.sites.length === 0) {
          new Notice(i18next.t("command.pull_post.error_no_sites"));
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

    const matterData = this.app.metadataCache.getFileCache(activeEditor.file)?.frontmatter;

    if (matterData?.halo?.site) {
      const site = this.settings.sites.find((site) => site.url === matterData.halo.site);

      if (!site) {
        new Notice(i18next.t("command.publish.error_no_matched_site"));
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
