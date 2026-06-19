import { Injectable, InternalServerErrorException, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createClient, SupabaseClient } from '@supabase/supabase-js';

@Injectable()
export class StorageService {
  private readonly supabase: SupabaseClient;
  private readonly bucket: string;
  private readonly logger = new Logger(StorageService.name);

  constructor(private readonly config: ConfigService) {
    const url = this.config.getOrThrow<string>('SUPABASE_URL');
    const key = this.config.getOrThrow<string>('SUPABASE_SERVICE_ROLE_KEY');
    this.bucket = this.config.getOrThrow<string>('SUPABASE_STORAGE_BUCKET');
    this.supabase = createClient(url, key, {
      auth: { persistSession: false },
    });
  }

  async upload(storagePath: string, buffer: Buffer, mimeType: string): Promise<void> {
    const { error } = await this.supabase.storage
      .from(this.bucket)
      .upload(storagePath, buffer, { contentType: mimeType, upsert: false });
    if (error) {
      this.logger.error(`Storage upload failed: ${error.message}`, { storagePath });
      throw new InternalServerErrorException('Error al subir el archivo');
    }
  }

  async createSignedUrl(storagePath: string, expiresInSeconds = 300): Promise<string> {
    const { data, error } = await this.supabase.storage
      .from(this.bucket)
      .createSignedUrl(storagePath, expiresInSeconds);
    if (error || !data?.signedUrl) {
      this.logger.error(`Signed URL creation failed: ${error?.message}`, { storagePath });
      throw new InternalServerErrorException('Error al generar el enlace de descarga');
    }
    return data.signedUrl;
  }

  async delete(storagePath: string): Promise<void> {
    const { error } = await this.supabase.storage.from(this.bucket).remove([storagePath]);
    if (error) {
      this.logger.error(`Storage delete failed: ${error.message}`, { storagePath });
      throw new InternalServerErrorException('Error al eliminar el archivo');
    }
  }

  async replace(oldPath: string, newPath: string, buffer: Buffer, mimeType: string): Promise<void> {
    await this.upload(newPath, buffer, mimeType);
    // Delete old file as best-effort — if it fails, the new file is already uploaded
    await this.delete(oldPath).catch((err: unknown) => {
      this.logger.warn(`Could not delete old file after replace: ${oldPath}`, err);
    });
  }
}
