import { AppDataSource } from './data-source';

async function main() {
  await AppDataSource.initialize();
  const direction = process.argv[2];
  if (direction === 'down') {
    await AppDataSource.undoLastMigration();
  } else {
    await AppDataSource.runMigrations();
  }
  await AppDataSource.destroy();
  console.log('migration ok:', direction ?? 'up');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});