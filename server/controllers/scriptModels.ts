import { type Express } from "express";
import { chooseDefaultScriptModel, listScriptModels } from "../services/scriptModelService.js";
import { describeError } from "../utils/describeError.js";
import { statusForScriptGenerationFailure } from "../utils/statusForScriptGenerationFailure.js";

/**
 * Registers the route that lists the models "Convert to script" can use. The
 * list comes live from Anthropic's Models API, so it needs ANTHROPIC_API_KEY
 * just like a conversion does.
 * @param app - The express application to attach the routes to
 */
export function registerScriptModelRoutes(app: Express): void {
  /**
   * Lists every model "Convert to script" can use, newest first, with the
   * effort levels each one offers (empty for "Standard"), whether it takes
   * adaptive thinking, and the fallback it would use - plus the model and
   * effort the picker should start on.
   * @route GET /api/script-models
   * @returns 200 with `{ models, defaultModelId, defaultEffort }` (both defaults null when no model is usable); 503 with `{ error }` when ANTHROPIC_API_KEY is not configured; 500 with `{ error }` when the Models API call fails
   */
  app.get("/api/script-models", async (_req, res) => {
    try {
      const models = await listScriptModels();
      const defaults = chooseDefaultScriptModel(models);
      res.json({
        models,
        defaultModelId: defaults?.modelId ?? null,
        defaultEffort: defaults?.effort ?? null,
      });
    } catch (error: unknown) {
      res.status(statusForScriptGenerationFailure(error)).json({ error: describeError(error) });
    }
  });
}
