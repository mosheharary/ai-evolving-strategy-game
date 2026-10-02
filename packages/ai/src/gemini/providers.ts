import { toResponseJsonSchema } from "../narrative/schemas";
import {
  ProviderError,
  type CallContext,
  type ImageGenerationProvider,
  type ImageRequest,
  type ImageResult,
  type StructuredTextRequest,
  type StructuredTextResult,
  type TextGenerationProvider,
} from "../providers/types";
import { imageDimensions } from "../images/dimensions";
import type { GoogleAIService } from "./GoogleAIService";

export class GeminiTextProvider implements TextGenerationProvider {
  readonly name = "gemini" as const;
  constructor(private readonly google: GoogleAIService) {}

  async generateStructured<T>(req: StructuredTextRequest<T>, ctx: CallContext): Promise<StructuredTextResult<T>> {
    const { json, usage, model } = await this.google.generateJson({
      model: req.model,
      system: req.system,
      prompt: req.prompt,
      jsonSchema: toResponseJsonSchema(req.schema),
      temperature: req.temperature,
      maxOutputTokens: req.maxOutputTokens,
      cachedContent: req.cachedContent,
      signal: ctx.signal,
    });
    // Treat model output as untrusted input: schema validation first.
    const parsed = req.schema.safeParse(json);
    if (!parsed.success) throw new ProviderError("malformed", `Gemini output failed schema ${req.promptId}`);
    return { data: parsed.data, model, usage };
  }
}

export class GeminiImageProvider implements ImageGenerationProvider {
  readonly name = "gemini" as const;
  constructor(private readonly google: GoogleAIService) {}

  async generateImage(req: ImageRequest, ctx: CallContext): Promise<ImageResult> {
    const r = await this.google.generateImage({ model: req.model, prompt: req.prompt, aspectRatio: req.aspectRatio, signal: ctx.signal });
    const dims = imageDimensions(r.bytes, r.mimeType);
    return { bytes: r.bytes, mimeType: r.mimeType, width: dims?.width ?? 0, height: dims?.height ?? 0, model: r.model };
  }
}
