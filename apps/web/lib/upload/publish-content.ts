import 'server-only';

import { logger } from '@/lib/logger';
import type { SocialProvider } from '@/lib/providers/registry';
import { PUBLISH_HANDLERS, type PublishHandlerResponse } from '@/lib/upload/publish-handlers';
import type { UploadAccountErrorCode } from '@/lib/upload/account-error-codes';
import { uploadErrorStatus, uploadRejectionCode } from '@/lib/upload/upload-error-status';
import {
  createPublishLedgerClient,
  isValidPublishScopeKey,
  mergePartitionResults,
  partitionPublishAccounts,
  type PublishLedgerPartition,
} from '@/lib/upload/publish-ledger';
import { releaseGrantedClaims, settlePartition } from '@/lib/upload/publish-ledger-settle';
import { startLedgerHeartbeat } from '@/lib/upload/publish-ledger-heartbeat';

export interface PublishContentInput {
  provider: SocialProvider;
  userId: string;
  formData: FormData;
  scopeKeyRaw: unknown;
  logId: string;
  startTime: number;
}

export interface PublishContentCompleted {
  ok: true;
  response: PublishHandlerResponse;
}

export interface PublishContentRejected {
  ok: false;
  status: number;
  errorCode: UploadAccountErrorCode;
  error: string;
  cause: unknown;
}

export type PublishContentResult = PublishContentCompleted | PublishContentRejected;

function rejection(cause: unknown): PublishContentRejected {
  const status = uploadErrorStatus(cause);
  return {
    ok: false,
    status,
    errorCode: uploadRejectionCode(status),
    error: cause instanceof Error ? cause.message : 'Unknown upload error',
    cause,
  };
}

async function dispatch(input: PublishContentInput): Promise<PublishHandlerResponse> {
  const { provider, userId, formData, scopeKeyRaw, logId, startTime } = input;
  const scopeKey = isValidPublishScopeKey(scopeKeyRaw) ? scopeKeyRaw : null;
  const ledgerClient = scopeKey !== null ? createPublishLedgerClient() : null;
  let partition: PublishLedgerPartition | null = null;
  if (scopeKey !== null && ledgerClient !== null) {
    partition = await partitionPublishAccounts(ledgerClient, scopeKey, provider, userId, formData);
  }

  const stopHeartbeat =
    partition !== null && partition.granted.length > 0 && ledgerClient !== null
      ? startLedgerHeartbeat(ledgerClient, partition)
      : null;
  try {
    if (partition !== null && partition.granted.length === 0) {
      const results = mergePartitionResults(partition, []);
      return {
        success: results.some((result) => result.success),
        successCount: results.filter((result) => result.success).length,
        results,
      };
    }
    const handlerForm = partition !== null ? partition.formData : formData;
    let response: PublishHandlerResponse;
    try {
      response = await PUBLISH_HANDLERS[provider](handlerForm, userId, logId, startTime);
    } catch (error) {
      if (partition !== null && ledgerClient !== null) {
        await releaseGrantedClaims(ledgerClient, partition, error);
      }
      throw error;
    }
    if (partition !== null && ledgerClient !== null) {
      const merged = await settlePartition(ledgerClient, partition, response.results);
      return {
        ...response,
        success: merged.some((result) => result.success),
        successCount: merged.filter((result) => result.success).length,
        results: merged,
      };
    }
    return response;
  } finally {
    stopHeartbeat?.();
  }
}

export async function publishContent(input: PublishContentInput): Promise<PublishContentResult> {
  try {
    const response = await dispatch(input);
    logger.info('[upload-content] handler finalizado', {
      provider: input.provider,
      success: response.success,
      logId: input.logId,
    });
    return { ok: true, response };
  } catch (error) {
    return rejection(error);
  }
}
