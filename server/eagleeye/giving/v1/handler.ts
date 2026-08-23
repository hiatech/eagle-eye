import type { GivingServiceHandler } from '../../../../src/generated/server/eagleeye/giving/v1/service_server';

import { getGivingSummary } from './get-giving-summary';

export const givingHandler: GivingServiceHandler = {
  getGivingSummary,
};
