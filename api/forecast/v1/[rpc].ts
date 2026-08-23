export const config = { runtime: 'edge' };

import { createDomainGateway, serverOptions } from '../../../server/gateway';
import { createForecastServiceRoutes } from '../../../src/generated/server/eagleeye/forecast/v1/service_server';
import { forecastHandler } from '../../../server/eagleeye/forecast/v1/handler';

export default createDomainGateway(
  createForecastServiceRoutes(forecastHandler, serverOptions),
);
