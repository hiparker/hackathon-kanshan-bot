import { describe, expect, it } from "vitest";
import {
  KANSHAN_PAT_RAW_CLIP_NAME,
  KANSHAN_PAT_SEMANTIC_CLIP_NAME,
} from "../KanshanModelPreview";
import { resolveKanshanClipName } from "../kanshanActionConfig";

describe("pat raw clip", () => {
  it("uses the visible Idle semantic clip mapping", () => {
    expect(KANSHAN_PAT_SEMANTIC_CLIP_NAME).toBe("Idle");
    expect(KANSHAN_PAT_RAW_CLIP_NAME).toBe("Sit_Cross_Legged_on_Floor");
    expect(resolveKanshanClipName(KANSHAN_PAT_SEMANTIC_CLIP_NAME)).toBe(
      KANSHAN_PAT_RAW_CLIP_NAME,
    );
  });
});
