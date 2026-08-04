import dotenv from "dotenv";
import { z } from "zod";

dotenv.config();

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().positive().default(3333),
  APP_ORIGIN: z.string().url(),
  DATABASE_URL: z.string().min(1),
  JWT_ACCESS_SECRET: z.string().min(32),
  JWT_REFRESH_SECRET: z.string().min(32),
  ACCESS_TOKEN_TTL: z.string().default("15m"),
  REFRESH_TOKEN_TTL_DAYS: z.coerce.number().int().positive().default(30),
  REFRESH_COOKIE_NAME: z.string().default("lumas_refresh_token"),
  COOKIE_SECURE: z.coerce.boolean().default(false),
  COMMISSION_DIVISOR: z.coerce.number().int().positive().default(4),
  OCR_LOW_CONFIDENCE_THRESHOLD: z.coerce.number().min(0).max(1).default(0.8),
  OCR_LANG: z.string().default("por+eng"),
  TZ: z.string().default("America/Sao_Paulo")
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  // Fail fast if critical runtime config is missing.
  throw new Error(`Invalid environment variables: ${parsed.error.message}`);
}

export const env = parsed.data;
