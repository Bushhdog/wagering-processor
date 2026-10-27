import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { DatabaseModule } from './database/database.module';
import { WalletsModule } from './wallets/wallets.module';
import { WageringModule } from './wagering/wagering.module';

@Module({
  imports: [DatabaseModule, WalletsModule, WageringModule],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}