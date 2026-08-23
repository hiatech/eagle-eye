import type { BatchServiceHandler } from '../../../../src/generated/server/eagleeye/batch/v1/service_server';

import { executeBatch } from './execute-batch';

export const batchHandler: BatchServiceHandler = {
  executeBatch,
};
