import { rs } from "@rstest/core";

rs.mock("obsidian", () => {
  const notices: string[] = [];

  class TAbstractFile {
    vault: unknown;
    path = "";
    name = "";
    parent: TFolder | null = null;
  }

  class TFile extends TAbstractFile {
    stat = {
      ctime: 0,
      mtime: 0,
      size: 0,
    };
    basename = "";
    extension = "";
  }

  class TFolder extends TAbstractFile {
    children: TAbstractFile[] = [];

    isRoot(): boolean {
      return this.path === "/";
    }
  }

  class Notice {
    constructor(message: string) {
      notices.push(message);
    }
  }

  class Modal {
    contentEl = {
      createEl: () => undefined,
      empty: () => undefined,
    };

    constructor(readonly app: unknown) {}

    open(): void {}

    close(): void {}
  }

  class Plugin {
    app: unknown;

    async loadData(): Promise<unknown> {
      return {};
    }

    async saveData(): Promise<void> {}

    addCommand(): void {}

    addRibbonIcon(): void {}

    addSettingTab(): void {}
  }

  class PluginSettingTab {
    containerEl = {
      empty: () => undefined,
    };

    constructor(
      readonly app: unknown,
      readonly plugin: unknown,
    ) {}
  }

  class Setting {
    constructor(readonly containerEl?: unknown) {}

    setName(): this {
      return this;
    }

    setDesc(): this {
      return this;
    }

    addButton(callback: (button: Button) => void): this {
      callback(new Button());
      return this;
    }

    addExtraButton(callback: (button: Button) => void): this {
      callback(new Button());
      return this;
    }

    addText(callback: (text: TextComponent) => void): this {
      callback(new TextComponent());
      return this;
    }

    addToggle(callback: (toggle: ToggleComponent) => void): this {
      callback(new ToggleComponent());
      return this;
    }
  }

  class Button {
    setButtonText(): this {
      return this;
    }

    setDisabled(): this {
      return this;
    }

    setCta(): this {
      return this;
    }

    setIcon(): this {
      return this;
    }

    onClick(): this {
      return this;
    }
  }

  class TextComponent {
    setValue(): this {
      return this;
    }

    onChange(): this {
      return this;
    }
  }

  class ToggleComponent {
    setValue(): this {
      return this;
    }

    onChange(): this {
      return this;
    }
  }

  const normalizePath = (path: string): string => {
    return path.replace(/\\/g, "/").replace(/\/+/g, "/").replace(/^\.\//, "").replace(/\/$/, "");
  };

  const getLinkpath = (linktext: string): string => {
    return linktext.split("|")[0].split("#")[0].trim();
  };

  return {
    getLinkpath,
    Modal,
    moment: {
      locale: () => "en",
    },
    normalizePath,
    Notice,
    Plugin,
    PluginSettingTab,
    requestUrl: rs.fn(),
    Setting,
    TAbstractFile,
    TFile,
    TFolder,
    __notices: notices,
  };
});
