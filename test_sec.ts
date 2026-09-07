import './src/config/env.ts';
import { prisma } from './src/lib/prisma.ts';

async function run() {
  const settings = await prisma.assessmentSecuritySetting.findMany();
  console.log(JSON.stringify(settings, null, 2));
}

run().catch(console.error).finally(() => prisma.$disconnect());
