import dotenv from 'dotenv';
import { z } from 'zod';

dotenv.config();

// Define the exact shape and types of our environment variables
const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.string().default('3000'),
  DATABASE_URL: z.string().url('DATABASE_URL must be a valid URL'),
  JWT_SECRET: z.string().min(10, 'JWT_SECRET must be at least 10 characters long'),
});

// Validate the current process.env against our schema
const parsedEnv = envSchema.safeParse(process.env);

if (!parsedEnv.success) {
  console.error('❌ Invalid environment variables:', parsedEnv.error.format());
  process.exit(1); // Stop the app from starting if env variables are missing or invalid
}

export const env = parsedEnv.data!;
