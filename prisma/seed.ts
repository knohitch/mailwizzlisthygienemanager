import { prisma } from '@/lib/db';
import { seedSyntheticDemoData } from '@/services/demo/seed-demo';

async function main() {
  if (
    process.env.NODE_ENV === 'production' &&
    process.env.ALLOW_DEMO_SEED_IN_PROD !== 'true'
  ) {
    throw new Error(
      'Refusing to seed synthetic 2,190-subscriber demo dataset in NODE_ENV=production. Set ALLOW_DEMO_SEED_IN_PROD=true only in disposable staging.'
    );
  }
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
