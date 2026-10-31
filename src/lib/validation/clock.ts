import { z } from "zod";
import { WORK_MODES } from "@/lib/attendance";
import { optionalText } from "./employees";

const id = z.number().int().positive();

/** What the work clock logs time to: a project, a task and an optional note. */
export const workSelectionSchema = z.object({ projectId: id, taskCategoryId: id, notes: optionalText(300) });

/** Clock in; without a selection the clock logs to the last project and task. */
export const startWorkSchema = z.object({ workMode: z.enum(WORK_MODES), selection: workSelectionSchema.nullable() });
