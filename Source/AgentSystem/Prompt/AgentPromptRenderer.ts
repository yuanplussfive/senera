import fs from "node:fs";
import path from "node:path";
import { Liquid } from "liquidjs";

export class AgentPromptRenderer {
  async renderFile(templatePath: string, context: Record<string, unknown>): Promise<string> {
    const template = fs.readFileSync(templatePath, "utf8");
    return this.createEngine(path.dirname(templatePath)).parseAndRender(template, context);
  }

  renderFileSync(templatePath: string, context: Record<string, unknown>): string {
    const template = fs.readFileSync(templatePath, "utf8");
    return this.createEngine(path.dirname(templatePath)).parseAndRenderSync(template, context);
  }

  async renderText(template: string, context: Record<string, unknown>): Promise<string> {
    return this.createEngine(process.cwd()).parseAndRender(template, context);
  }

  renderTextSync(template: string, context: Record<string, unknown>): string {
    return this.createEngine(process.cwd()).parseAndRenderSync(template, context);
  }

  private createEngine(root: string): Liquid {
    return new Liquid({
      root,
      strictVariables: true,
      strictFilters: true,
    });
  }
}
