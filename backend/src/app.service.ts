import { Injectable } from '@nestjs/common';

@Injectable()
export class AppService {
  getRoot() {
    return {
      message: 'LOGICONTROL PRO API',
      version: '0.1.0',
      health: '/api/health',
    };
  }
}
