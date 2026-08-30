import { z } from "zod";

export const productSchema = z.object({
  name: z.string().min(1, "Name is required").max(255, "Name must be 255 characters or fewer"),
  expiry_date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Invalid date format")
    .refine((val) => val >= new Date().toISOString().split("T")[0], "Expiry date must be today or in the future"),
});
