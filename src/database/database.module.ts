import { Global, Module } from '@nestjs/common';
import { AppDataSource } from '../data-source';

export const DATA_SOURCE = 'DATA_SOURCE';

@Global()
@Module({
  providers: [
    {
      provide: DATA_SOURCE,
      useFactory: async () =>
        AppDataSource.isInitialized ? AppDataSource : AppDataSource.initialize(),
    },
  ],
  exports: [DATA_SOURCE],
})
export class DatabaseModule {}