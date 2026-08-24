import dotenv from "dotenv";
import { z } from "zod";

dotenv.config();

const booleanFromEnv = z.preprocess((value) => {
  if (typeof value === "string") {
    if (value.toLowerCase() === "true") return true;
    if (value.toLowerCase() === "false") return false;
  }
  return value;
}, z.boolean());

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
  COOKIE_SAME_SITE: z.enum(["lax", "strict", "none"]).default("lax"),
  COOKIE_SECURE: booleanFromEnv.default(false),
  TRUST_PROXY: booleanFromEnv.default(false),
  LOGIN_RATE_LIMIT_MAX: z.coerce.number().int().positive().default(5),
  COMMISSION_DIVISOR: z.coerce.number().int().positive().default(4),
  OCR_LOW_CONFIDENCE_THRESHOLD: z.coerce.number().min(0).max(1).default(0.8),
  OCR_LANG: z.string().default("por+eng"),
  TZ: z.string().default("America/Sao_Paulo"),
  STORAGE_DRIVER: z.enum(["local", "s3"]).default("local"),
  LOCAL_STORAGE_PATH: z.string().default(".data/evidence"),
  S3_ENDPOINT: z.string().url().optional(),
  S3_REGION: z.string().default("auto"),
  S3_BUCKET: z.string().optional(),
  S3_ACCESS_KEY_ID: z.string().optional(),
  S3_SECRET_ACCESS_KEY: z.string().optional(),
  STORAGE_DELETE_INTERVAL_MS: z.coerce.number().int().min(10_000).default(60_000)
}).superRefine((value, context) => {
  if (value.COOKIE_SAME_SITE === "none" && value.NODE_ENV !== "production" && !value.COOKIE_SECURE) {
    context.addIssue({
      code: "custom",
      path: ["COOKIE_SAME_SITE"],
      message: "SameSite=None exige cookie Secure."
    });
  }

  if (value.STORAGE_DRIVER === "s3") {
    for (const key of ["S3_BUCKET", "S3_ACCESS_KEY_ID", "S3_SECRET_ACCESS_KEY"] as const) {
      if (!value[key]) {
        context.addIssue({ code: "custom", path: [key], message: `${key} é obrigatório com STORAGE_DRIVER=s3.` });
      }
    }
  }
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  // Fail fast if critical runtime config is missing.
  throw new Error(`Invalid environment variables: ${parsed.error.message}`);
}

export const env = parsed.data;
