import { z } from "zod";
import { EMAIL_MODES } from "@/lib/notifications";

export const emailModeSchema = z.object({ mode: z.enum(EMAIL_MODES) });
