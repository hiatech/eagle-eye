import type { NaturalServiceHandler } from '../../../../src/generated/server/eagleeye/natural/v1/service_server';

import { listNaturalEvents } from './list-natural-events';

export const naturalHandler: NaturalServiceHandler = {
  listNaturalEvents,
};
