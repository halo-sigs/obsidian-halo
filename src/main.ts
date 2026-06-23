import i18next from "i18next";
import { Notice, Plugin, moment } from "obsidian";
import { resources } from "./i18n";
import { addHaloIcon } from "./icons";
import { openPostSelectionModal } from "./post-selection-model";
import HaloService from "./service";
import {
  DEFAULT_SETTINGS,
  type HaloSetting,
  HaloSettingTab,
  type HaloSite,
  isSameSiteUrl,
  normalizeSite,
} from "./settings";
import { openSiteSelectionModal } from "./site-selection-modal";

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

        if (!this.canPublishToSite(site)) {
          return;
        }

        const service = new HaloService(this.app, this.settings, site);
        const uploadResult = await this.uploadImagesForPublish(service);

        if (!uploadResult.success) {
          return;
        }

        await service.publishPost({ markdown: uploadResult.markdown });
      },
    });

    this.addCommand({
      id: "upload-images",
      name: i18next.t("command.upload_images.name"),
      callback: async () => {
        await this.uploadImagesCommand();
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

        const site = this.getSiteByUrl(matterData.halo.site);

        if (!site) {
          new Notice(i18next.t("command.update_post.error_no_matched_site"));
          return;
        }

        const service = new HaloService(this.app, this.settings, site);

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

        const service = new HaloService(this.app, this.settings, site);
        await service.pullPost(post.post.metadata.name);
      },
    });

    this.addSettingTab(new HaloSettingTab(this));
  }

  onunload() {}

  async loadSettings() {
    const settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
    this.settings = {
      ...settings,
      sites: settings.sites.map(normalizeSite),
      imageUploadCache: { ...(settings.imageUploadCache ?? {}) },
    };
  }

  async saveSettings() {
    this.settings.sites = this.settings.sites.map(normalizeSite);
    await this.saveData(this.settings);
  }

  private async publishCommand() {
    const { activeEditor } = this.app.workspace;

    if (!activeEditor || !activeEditor.file) {
      return;
    }

    const matterData = this.app.metadataCache.getFileCache(activeEditor.file)?.frontmatter;

    if (matterData?.halo?.site) {
      const site = this.getSiteByUrl(matterData.halo.site);

      if (!site) {
        new Notice(i18next.t("command.publish.error_no_matched_site"));
        return;
      }

      const service = new HaloService(this.app, this.settings, site);
      const uploadResult = await this.uploadImagesForPublish(service);

      if (!uploadResult.success) {
        return;
      }

      await service.publishPost({ markdown: uploadResult.markdown });
      return;
    }

    if (this.settings.sites.length === 0) {
      new Notice(i18next.t("command.publish.error_no_sites"));
      return;
    }

    const site = await openSiteSelectionModal(this);
    const service = new HaloService(this.app, this.settings, site);
    const uploadResult = await this.uploadImagesForPublish(service);

    if (!uploadResult.success) {
      return;
    }

    await service.publishPost({ markdown: uploadResult.markdown });
  }

  private async uploadImagesCommand() {
    const site = await this.getSiteForActiveFile();

    if (!site) {
      return;
    }

    const service = new HaloService(this.app, this.settings, site);
    await service.uploadImages();
    await this.saveSettings();
  }

  private async getSiteForActiveFile(): Promise<HaloSite | undefined> {
    const { activeEditor } = this.app.workspace;

    if (!activeEditor || !activeEditor.file) {
      return undefined;
    }

    const matterData = this.app.metadataCache.getFileCache(activeEditor.file)?.frontmatter;

    if (matterData?.halo?.site) {
      const site = this.getSiteByUrl(matterData.halo.site);

      if (!site) {
        new Notice(i18next.t("command.upload_images.error_no_matched_site"));
        return undefined;
      }

      return site;
    }

    if (this.settings.sites.length === 0) {
      new Notice(i18next.t("command.upload_images.error_no_sites"));
      return undefined;
    }

    if (this.settings.sites.length === 1) {
      return this.settings.sites[0];
    }

    return openSiteSelectionModal(this);
  }

  private async uploadImagesForPublish(service: HaloService): Promise<{ success: boolean; markdown?: string }> {
    const uploadResult = await service.uploadImages({ silent: true });
    await this.saveSettings();

    if (uploadResult.failedCount > 0) {
      new Notice(i18next.t("service.error_upload_images_failed_publish_aborted", { failed: uploadResult.failedCount }));
      return { success: false };
    }

    return {
      success: true,
      markdown: uploadResult.markdown,
    };
  }

  private canPublishToSite(site: HaloSite): boolean {
    const { activeEditor } = this.app.workspace;

    if (!activeEditor || !activeEditor.file) {
      return false;
    }

    const matterData = this.app.metadataCache.getFileCache(activeEditor.file)?.frontmatter;

    if (matterData?.halo?.site && !isSameSiteUrl(matterData.halo.site, site.url)) {
      new Notice(i18next.t("service.error_site_not_match"));
      return false;
    }

    return true;
  }

  private getSiteByUrl(url: string): HaloSite | undefined {
    return this.settings.sites.find((site) => isSameSiteUrl(site.url, url));
  }
}
