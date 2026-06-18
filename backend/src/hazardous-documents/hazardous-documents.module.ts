import { Module } from '@nestjs/common';
import { HazardousDocumentsController } from './hazardous-documents.controller';
import { HazardousDocumentsService } from './hazardous-documents.service';

@Module({
  controllers: [HazardousDocumentsController],
  providers: [HazardousDocumentsService],
  exports: [HazardousDocumentsService],
})
export class HazardousDocumentsModule {}
