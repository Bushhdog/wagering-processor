import { Body, Controller, Get, Inject, Param, Post } from '@nestjs/common';
import { WalletsService } from './wallets.service';

@Controller('wallets')
export class WalletsController {
  constructor(@Inject(WalletsService) private readonly service: WalletsService) {}

  @Post()
  create(@Body() body: unknown) {
    return this.service.create(body);
  }
    
  @Get(':id')
  get(@Param('id') id: string) {
    return this.service.get(id);
  }

  @Post(':id/reconciliation')
  reconcile(@Param('id') id: string) {
    return this.service.reconcile(id);
  }
}