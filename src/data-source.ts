import { DataSource } from 'typeorm';

export const AppDataSource = new DataSource({
  type: 'postgres',
  host: 'localhost',
  port: 5432,
  username: 'wagering',
  password: 'wagering',
  database: 'wagering',
  migrations: [__dirname + '/migrations/*.ts'],
});