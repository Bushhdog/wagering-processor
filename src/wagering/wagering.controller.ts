import { Body, Controller, Headers, Inject, Post } from '@nestjs/common';
import { WageringService } from './wagering.service';

@Controller('wagering/transactions')
export class WageringController {
  constructor(@Inject(WageringService) private readonly service: WageringService) {}

  @Post()
  submit(@Headers('idempotency-key') key: string | undefined, @Body() body: unknown) {
    return this.service.submit(key, body);
  }
}