import { chromium, type BrowserContext, type Page } from 'playwright-core';

export class CdpBrowserSession {
  private context: BrowserContext | null = null;
  private page: Page | null = null;
  private cdpUrl: string;

  constructor(cdpUrl: string) {
    this.cdpUrl = cdpUrl;
  }

  async launch(): Promise<Page> {
    if (this.page) return this.page;

    const browser = await chromium.connectOverCDP(this.cdpUrl);
    
    // Attempt to get existing contexts, otherwise create one
    const contexts = browser.contexts();
    this.context = contexts.length > 0 ? contexts[0] : await browser.newContext();

    const pages = this.context.pages();
    this.page = pages.length > 0 ? pages[0] : await this.context.newPage();

    return this.page;
  }

  async close() {
    if (this.context) {
      await this.context.close();
    }
  }
}
