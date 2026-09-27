import 'dotenv/config';
import { OAuth2Client } from 'google-auth-library';
import * as fs from 'fs';
import { createGoogleOAuth2Client, uploadYouTubeVideo, createVideoMetadata } from './lib/youtube';
import { logger } from './lib/logger';
import { AuthError, UploadError, ValidationError } from './lib/errors';
import { withUploadTimeout } from './lib/timeout';
import { createSupabaseServiceClient } from './lib/supabase/service';
import {
  getSocialAccountTokens,
  listSocialAccounts,
  touchSocialAccount,
  updateSocialAccountTokens,
  type SocialTokenPayload,
} from './lib/social-accounts';

console.log('🎬 Post Engineer Script (Supabase-backed)');
console.log('📅 Data:', new Date().toLocaleString('pt-BR'));
console.log('📂 Diretório de trabalho:', process.cwd());
console.log('');

//---------------
// CliArgs — arguments accepted by the script
// videoPath: positional | userId: --user-id or env UPLOAD_USER_ID
// accountId: --account-id (optional; defaults to the most recent YouTube account)
//---------------
interface CliArgs {
  videoPath: string;
  userId: string;
  accountId: string | null;
}

//---------------
// parseCliArgs — extracts positional args and --key value flags
//---------------
function parseCliArgs(argv: string[]): CliArgs {
  const positional: string[] = [];
  let userId: string | null = null;
  let accountId: string | null = null;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--user-id') {
      userId = argv[i + 1] ?? null;
      i++;
    } else if (arg === '--account-id') {
      accountId = argv[i + 1] ?? null;
      i++;
    } else {
      positional.push(arg);
    }
  }

  const videoPath = positional[0] ?? null;
  const resolvedUserId = userId ?? process.env.UPLOAD_USER_ID ?? null;

  if (!videoPath || !resolvedUserId) {
    console.error('❌ Uso: ts-node upload.ts <caminho-do-video> --user-id <uuid> [--account-id <channelId>]');
    console.error('   Exemplo: ts-node upload.ts ./videos/meu-video.mp4 --user-id 00000000-0000-0000-0000-000000000000 --account-id UCxxxx');
    console.error('');
    console.error('   O userId também pode vir da env UPLOAD_USER_ID.');
    console.error('');
    console.error('📋 Metadados via variáveis de ambiente:');
    console.error('   VIDEO_TITLE="Título do vídeo" (obrigatória)');
    console.error('   VIDEO_DESCRIPTION="Descrição do vídeo"');
    console.error('   VIDEO_TAGS="tag1,tag2,tag3"');
    console.error('   VIDEO_PRIVACY="public|private|unlisted"');
    process.exit(1);
  }

  return { videoPath, userId: resolvedUserId, accountId };
}

//---------------
// getAuthClient — resolves the API key, loads the ENCRYPTED tokens from
// Supabase, auto-refreshes them when expired and persists the new tokens
// back (always encrypted). No token is ever read from or written to a file.
//---------------
async function getAuthClient(ownerId: string, accountId: string | null): Promise<OAuth2Client> {
  const logId = logger.generateLogId();

  console.log('🔐 Authenticating via Supabase...');
  const ownerUserId = ownerId;
  console.log(`✅ Owner: ${ownerUserId.substring(0, 8)}...`);

  const supabase = createSupabaseServiceClient();

  // Pick the account: the one given via --account-id or the most recent one
  let targetAccountId = accountId;

  if (!targetAccountId) {
    console.log('🔎 No --account-id given, looking up the most recent YouTube account...');
    const accounts = await listSocialAccounts(supabase, ownerUserId, 'youtube');

    if (accounts.length === 0) {
      throw new AuthError(
        'Nenhuma conta YouTube conectada para o dono desta API key. Conecte via /api/google-oauth/start primeiro.',
        'no_accounts',
      );
    }

    targetAccountId = accounts[0].providerAccountId;
    console.log(`✅ Conta selecionada: ${accounts[0].accountName ?? targetAccountId}`);
  }

  const { tokens } = await getSocialAccountTokens(supabase, ownerUserId, 'youtube', targetAccountId);
  console.log('✅ Tokens carregados do Supabase (social_accounts)');

  const oauth2Client = await createGoogleOAuth2Client();
  oauth2Client.setCredentials(tokens);

  // Auto-refresh when the token is expired — new tokens are persisted encrypted
  if (tokens.expiry_date && tokens.expiry_date < Date.now()) {
    console.log('⏰ Token expirado, realizando refresh...');

    if (!tokens.refresh_token) {
      throw new AuthError('Token expirado e não há refresh token. Inicie OAuth novamente', 'expired_token');
    }

    const { credentials } = await oauth2Client.refreshAccessToken();

    if (!credentials.access_token) {
      throw new AuthError('Failed to refresh access token - no access token returned', 'token_refresh_failed');
    }

    const updatedTokens: SocialTokenPayload = {
      access_token: credentials.access_token,
      refresh_token: credentials.refresh_token || tokens.refresh_token,
      token_type: credentials.token_type || tokens.token_type || 'Bearer',
      expiry_date: credentials.expiry_date ?? undefined,
    };

    await updateSocialAccountTokens(supabase, ownerUserId, 'youtube', targetAccountId, updatedTokens);
    oauth2Client.setCredentials(updatedTokens);
    console.log('✅ Token refresh realizado e persistido criptografado no Supabase!');
  }

  await touchSocialAccount(supabase, ownerUserId, 'youtube', targetAccountId);
  logger.info('Auth via Supabase concluída', { logId, metadata: { accountId: targetAccountId } });

  return oauth2Client;
}

async function uploadVideoWithOptions(
  auth: OAuth2Client, 
  videoPath: string, 
  options: {
    title: string;
    description?: string;
    tags?: string[];
    privacyStatus?: 'public' | 'private' | 'unlisted';
  }
): Promise<{ id: string; url: string }> {
  const logId = logger.generateLogId();
  
  console.log('🔧 Preparando upload para YouTube...');
  
  const fileSize = fs.statSync(videoPath).size;
  console.log(`📹 Tamanho: ${(fileSize / 1024 / 1024).toFixed(2)} MB`);
  console.log(`📁 Caminho: ${videoPath}`);

  // File validation
  if (fileSize > 2 * 1024 * 1024 * 1024) {
    throw new ValidationError('Arquivo muito grande. Máximo 2GB', 'video');
  }

  // Required field validation
  if (!options.title || options.title.trim() === '') {
    throw new ValidationError('Título do vídeo é obrigatório', 'title');
  }

  if (!options.description || options.description.trim() === '') {
    throw new ValidationError('Descrição do vídeo é obrigatória', 'description');
  }

  if (!options.tags || options.tags.length === 0) {
    throw new ValidationError('Pelo menos uma tag é obrigatória', 'tags');
  }

  const validPrivacyStatus = ['public', 'private', 'unlisted'];
  if (!options.privacyStatus || !validPrivacyStatus.includes(options.privacyStatus)) {
    throw new ValidationError('Status de privacidade inválido. Use "public", "private" ou "unlisted"', 'privacyStatus');
  }

  console.log('📋 Metadados do vídeo:');
  console.log(`   Título: ${options.title}`);
  console.log(`   Descrição: ${options.description}`);
  console.log(`   Tags: ${options.tags.join(', ')}`);
  console.log(`   Privacidade: ${options.privacyStatus}`);

  console.log('⏳ Iniciando upload para YouTube...');
  console.log('⚠️  Este processo pode levar vários minutos...');

  try {
    logger.logUploadStart(logId, {
      endpoint: 'script_upload',
      method: 'cli',
      timestamp: new Date().toISOString(),
      metadata: {
        videoPath,
        fileSize,
        title: options.title
      }
    });

    // Read the video as a Buffer
    const videoBuffer = fs.readFileSync(videoPath);
    const videoMetadata = createVideoMetadata(options);

    // Upload with timeout
    const uploadResult = await withUploadTimeout(
      uploadYouTubeVideo(auth, videoBuffer, videoMetadata)
    );

    logger.logUploadSuccess(logId, {
      videoId: uploadResult.id,
      videoUrl: uploadResult.url,
      duration: Date.now() - Date.now()
    });

    console.log('📦 Upload concluído com sucesso!');
    console.log(`🔗 https://www.youtube.com/watch?v=${uploadResult.id}`);
    console.log(`📝 Video ID: ${uploadResult.id}`);
    console.log(`🆔 Log ID: ${logId}`);

    return uploadResult;
    
  } catch (error) {
    process.stdout.write('\r' + ' '.repeat(50) + '\r'); // Clear line
    
    logger.logUploadError(logId, error instanceof Error ? error : new Error('Erro desconhecido'), {
      duration: Date.now() - Date.now(),
      endpoint: 'script_upload',
      method: 'cli'
    });
    
    if (error instanceof ValidationError) {
      console.error(`❌ ${error.message}`);
      throw error;
    } else if (error instanceof UploadError) {
      console.error('❌ Erro durante o upload:', error.message);
      throw error;
    } else {
      console.error('❌ Erro desconhecido:', error);
      throw new UploadError('Erro desconhecido durante upload', 'processing');
    }
  }
}

async function main(): Promise<void> {
  const logId = logger.generateLogId();
  
  console.log('🚀 Iniciando processo de upload de vídeo...');
  console.log('='.repeat(50));

  const { videoPath, userId, accountId } = parseCliArgs(process.argv.slice(2));
  console.log(`📝 Argumentos recebidos: ${process.argv.slice(2).join(', ')}`);

  console.log(`🔍 Verificando arquivo: ${videoPath}`);
  if (!fs.existsSync(videoPath)) {
    console.error(`❌ Arquivo não encontrado: ${videoPath}`);
    process.exit(1);
  }

  console.log('✅ Arquivo encontrado, iniciando autenticação via Supabase...');
  const auth = await getAuthClient(userId, accountId);

  console.log('📦 Lendo variáveis de ambiente para metadados...');
  
  if (!process.env.VIDEO_TITLE) {
    throw new Error('VIDEO_TITLE environment variable is required');
  }
  
  const uploadOptions = {
    title: process.env.VIDEO_TITLE,
    description: process.env.VIDEO_DESCRIPTION || '',
    tags: process.env.VIDEO_TAGS?.split(',').map(t => t.trim()).filter(t => t.length > 0) || [],
    privacyStatus: (process.env.VIDEO_PRIVACY || 'public') as 'public' | 'private' | 'unlisted'
  };

  console.log('🎯 Iniciando upload com as opções configuradas...');
  await uploadVideoWithOptions(auth, videoPath, uploadOptions);

  console.log('='.repeat(50));
  console.log('✨ Processo concluído com sucesso!');
  console.log(`🆔 Log ID: ${logId}`);
}

main().catch(error => {
  console.error('');
  console.error('❌ ERRO FATAL:');
  console.error('='.repeat(50));
  
  if (error instanceof Error) {
    console.error(`Mensagem: ${error.message}`);
    if (error.stack) {
      console.error(`Stack: ${error.stack}`);
    }
  } else {
    console.error('Erro desconhecido:', error);
  }
  
  console.error('='.repeat(50));
  console.error('💡 Dica: Verifique os logs em logs/combined.log para mais detalhes');
  process.exit(1);
});
