import { prisma } from '@/lib/db';
import { seedSyntheticDemoData } from '@/services/demo/seed-demo';

async function main() {
  console.log('Seeding MailWizz List Hygiene Manager synthetic demo fixtures...');
  const result = await seedSyntheticDemoData();
  console.log('Seed completed:', result);
}

main()
  .catch((err) => {
    console.error('Seed failed:', err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
