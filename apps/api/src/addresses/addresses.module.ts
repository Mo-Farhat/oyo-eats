import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Inject,
  Module,
  Param,
  Patch,
  Post,
} from '@nestjs/common';
import {
  addressInputSchema,
  addressUpdateSchema,
  type AddressInput,
  type AddressUpdate,
} from '@oyo/shared';
import type { AuthContext } from '../auth/auth.service.js';
import { CurrentAuth, RequirePermission } from '../auth/decorators.js';
import { UuidPipe } from '../common/uuid.pipe.js';
import { ZodPipe } from '../common/zod.pipe.js';
import type { Config } from '../config.js';
import type { Db } from '../db/client.js';
import { CONFIG, DB } from '../tokens.js';
import { AddressesService } from './addresses.service.js';

@Controller('me/addresses')
export class AddressesController {
  constructor(@Inject(AddressesService) private readonly addresses: AddressesService) {}

  @Get()
  @RequirePermission('profile.manage_own')
  list(@CurrentAuth() auth: AuthContext) {
    return this.addresses.list(auth);
  }

  @Post()
  @RequirePermission('profile.manage_own')
  create(
    @CurrentAuth() auth: AuthContext,
    @Body(new ZodPipe(addressInputSchema)) body: AddressInput,
  ) {
    return this.addresses.create(auth, body);
  }

  @Patch(':id')
  @RequirePermission('profile.manage_own')
  update(
    @CurrentAuth() auth: AuthContext,
    @Param('id', UuidPipe) id: string,
    @Body(new ZodPipe(addressUpdateSchema)) body: AddressUpdate,
  ) {
    return this.addresses.update(auth, id, body);
  }

  @Delete(':id')
  @HttpCode(204)
  @RequirePermission('profile.manage_own')
  async remove(@CurrentAuth() auth: AuthContext, @Param('id', UuidPipe) id: string) {
    await this.addresses.remove(auth, id);
  }
}

@Module({
  controllers: [AddressesController],
  providers: [
    {
      provide: AddressesService,
      inject: [DB, CONFIG],
      useFactory: (db: Db, config: Config) => new AddressesService(db, config.encryptionKey),
    },
  ],
})
export class AddressesModule {}
