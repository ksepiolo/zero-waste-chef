import { z } from "zod";

export const severitySchema = z.enum(["critical", "major", "minor", "nit"]);
export type Severity = z.infer<typeof severitySchema>;

export const reviewFindingSchema = z.object({
  severity: severitySchema.describe("How badly this affects correctness or maintainability."),
  file: z.string().describe("Path of the file the finding belongs to, as given in the input."),
  line: z
    .number()
    .int()
    .positive()
    .nullable()
    .describe("1-indexed line the finding anchors to, or null when it spans the whole file."),
  title: z.string().describe("One short sentence naming the defect."),
  explanation: z.string().describe("Why it is a problem, with the concrete failure it causes."),
  suggestion: z.string().describe("The smallest change that fixes it."),
});
export type ReviewFinding = z.infer<typeof reviewFindingSchema>;

export const reviewResultSchema = z.object({
  summary: z.string().describe("Two or three sentences on the overall state of the code."),
  findings: z.array(reviewFindingSchema).describe("Findings, most severe first. Empty when the code is sound."),
});
export type ReviewResult = z.infer<typeof reviewResultSchema>;

/** One file handed to the reviewer. */
export interface ReviewInputFile {
  path: string;
  content: string;
}
