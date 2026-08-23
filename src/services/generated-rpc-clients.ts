import type { AviationServiceClient as AviationServiceClientInstance } from '@/generated/client/eagleeye/aviation/v1/service_client';
import type { ClimateServiceClient as ClimateServiceClientInstance } from '@/generated/client/eagleeye/climate/v1/service_client';
import type { ConflictServiceClient as ConflictServiceClientInstance } from '@/generated/client/eagleeye/conflict/v1/service_client';
import type { ConsumerPricesServiceClient as ConsumerPricesServiceClientInstance } from '@/generated/client/eagleeye/consumer_prices/v1/service_client';
import type { CyberServiceClient as CyberServiceClientInstance } from '@/generated/client/eagleeye/cyber/v1/service_client';
import type { DisplacementServiceClient as DisplacementServiceClientInstance } from '@/generated/client/eagleeye/displacement/v1/service_client';
import type { EconomicServiceClient as EconomicServiceClientInstance } from '@/generated/client/eagleeye/economic/v1/service_client';
import type { ForecastServiceClient as ForecastServiceClientInstance } from '@/generated/client/eagleeye/forecast/v1/service_client';
import type { GivingServiceClient as GivingServiceClientInstance } from '@/generated/client/eagleeye/giving/v1/service_client';
import type { HealthServiceClient as HealthServiceClientInstance } from '@/generated/client/eagleeye/health/v1/service_client';
import type { InfrastructureServiceClient as InfrastructureServiceClientInstance } from '@/generated/client/eagleeye/infrastructure/v1/service_client';
import type { IntelligenceServiceClient as IntelligenceServiceClientInstance } from '@/generated/client/eagleeye/intelligence/v1/service_client';
import type { MaritimeServiceClient as MaritimeServiceClientInstance } from '@/generated/client/eagleeye/maritime/v1/service_client';
import type { MarketServiceClient as MarketServiceClientInstance } from '@/generated/client/eagleeye/market/v1/service_client';
import type { MilitaryServiceClient as MilitaryServiceClientInstance } from '@/generated/client/eagleeye/military/v1/service_client';
import type { NaturalServiceClient as NaturalServiceClientInstance } from '@/generated/client/eagleeye/natural/v1/service_client';
import type { NewsServiceClient as NewsServiceClientInstance } from '@/generated/client/eagleeye/news/v1/service_client';
import type { PositiveEventsServiceClient as PositiveEventsServiceClientInstance } from '@/generated/client/eagleeye/positive_events/v1/service_client';
import type { PredictionServiceClient as PredictionServiceClientInstance } from '@/generated/client/eagleeye/prediction/v1/service_client';
import type { RadiationServiceClient as RadiationServiceClientInstance } from '@/generated/client/eagleeye/radiation/v1/service_client';
import type { ResearchServiceClient as ResearchServiceClientInstance } from '@/generated/client/eagleeye/research/v1/service_client';
import type { ResilienceServiceClient as ResilienceServiceClientInstance } from '@/generated/client/eagleeye/resilience/v1/service_client';
import type { SanctionsServiceClient as SanctionsServiceClientInstance } from '@/generated/client/eagleeye/sanctions/v1/service_client';
import type { ScenarioServiceClient as ScenarioServiceClientInstance } from '@/generated/client/eagleeye/scenario/v1/service_client';
import type { SeismologyServiceClient as SeismologyServiceClientInstance } from '@/generated/client/eagleeye/seismology/v1/service_client';
import type { SupplyChainServiceClient as SupplyChainServiceClientInstance } from '@/generated/client/eagleeye/supply_chain/v1/service_client';
import type { ThermalServiceClient as ThermalServiceClientInstance } from '@/generated/client/eagleeye/thermal/v1/service_client';
import type { TradeServiceClient as TradeServiceClientInstance } from '@/generated/client/eagleeye/trade/v1/service_client';
import type { UnrestServiceClient as UnrestServiceClientInstance } from '@/generated/client/eagleeye/unrest/v1/service_client';
import type { WebcamServiceClient as WebcamServiceClientInstance } from '@/generated/client/eagleeye/webcam/v1/service_client';
import type { WildfireServiceClient as WildfireServiceClientInstance } from '@/generated/client/eagleeye/wildfire/v1/service_client';

type RpcClientOptions = { fetch?: typeof fetch; defaultHeaders?: Record<string, string> };
type RpcClientConstructor<T extends object> = new (baseURL: string, options?: RpcClientOptions) => T;
type RpcClientConstructorLoader<T extends object> = () => Promise<RpcClientConstructor<T>>;

export function createLazyRpcClientConstructor<T extends object>(loadConstructor: RpcClientConstructorLoader<T>): RpcClientConstructor<T> {
  return function LazyRpcClient(baseURL: string, options?: RpcClientOptions): T {
    let clientPromise: Promise<T> | undefined;
    const getClient = () => {
      if (!clientPromise) {
        clientPromise = loadConstructor()
          .then((ClientCtor) => new ClientCtor(baseURL, options))
          .catch((error) => {
            clientPromise = undefined;
            throw error;
          });
      }
      return clientPromise;
    };

    return new Proxy({}, {
      get(target, property, receiver) {
        if (property === 'then') return undefined;
        if (typeof property === 'symbol') return Reflect.get(target, property, receiver);
        return (...args: unknown[]) => getClient().then((client) => {
          const value = (client as Record<PropertyKey, unknown>)[property];
          return typeof value === 'function' ? value.apply(client, args) : value;
        });
      },
    }) as T;
  } as unknown as RpcClientConstructor<T>;
}

export const AviationServiceClient = createLazyRpcClientConstructor<AviationServiceClientInstance>(async () => {
  const module = await import('@/generated/client/eagleeye/aviation/v1/service_client');
  return module.AviationServiceClient;
});

export const ClimateServiceClient = createLazyRpcClientConstructor<ClimateServiceClientInstance>(async () => {
  const module = await import('@/generated/client/eagleeye/climate/v1/service_client');
  return module.ClimateServiceClient;
});

export const ConflictServiceClient = createLazyRpcClientConstructor<ConflictServiceClientInstance>(async () => {
  const module = await import('@/generated/client/eagleeye/conflict/v1/service_client');
  return module.ConflictServiceClient;
});

export const ConsumerPricesServiceClient = createLazyRpcClientConstructor<ConsumerPricesServiceClientInstance>(async () => {
  const module = await import('@/generated/client/eagleeye/consumer_prices/v1/service_client');
  return module.ConsumerPricesServiceClient;
});

export const CyberServiceClient = createLazyRpcClientConstructor<CyberServiceClientInstance>(async () => {
  const module = await import('@/generated/client/eagleeye/cyber/v1/service_client');
  return module.CyberServiceClient;
});

export const DisplacementServiceClient = createLazyRpcClientConstructor<DisplacementServiceClientInstance>(async () => {
  const module = await import('@/generated/client/eagleeye/displacement/v1/service_client');
  return module.DisplacementServiceClient;
});

export const EconomicServiceClient = createLazyRpcClientConstructor<EconomicServiceClientInstance>(async () => {
  const module = await import('@/generated/client/eagleeye/economic/v1/service_client');
  return module.EconomicServiceClient;
});

export const ForecastServiceClient = createLazyRpcClientConstructor<ForecastServiceClientInstance>(async () => {
  const module = await import('@/generated/client/eagleeye/forecast/v1/service_client');
  return module.ForecastServiceClient;
});

export const GivingServiceClient = createLazyRpcClientConstructor<GivingServiceClientInstance>(async () => {
  const module = await import('@/generated/client/eagleeye/giving/v1/service_client');
  return module.GivingServiceClient;
});

export const HealthServiceClient = createLazyRpcClientConstructor<HealthServiceClientInstance>(async () => {
  const module = await import('@/generated/client/eagleeye/health/v1/service_client');
  return module.HealthServiceClient;
});

export const InfrastructureServiceClient = createLazyRpcClientConstructor<InfrastructureServiceClientInstance>(async () => {
  const module = await import('@/generated/client/eagleeye/infrastructure/v1/service_client');
  return module.InfrastructureServiceClient;
});

export const IntelligenceServiceClient = createLazyRpcClientConstructor<IntelligenceServiceClientInstance>(async () => {
  const module = await import('@/generated/client/eagleeye/intelligence/v1/service_client');
  return module.IntelligenceServiceClient;
});

export const MaritimeServiceClient = createLazyRpcClientConstructor<MaritimeServiceClientInstance>(async () => {
  const module = await import('@/generated/client/eagleeye/maritime/v1/service_client');
  return module.MaritimeServiceClient;
});

export const MarketServiceClient = createLazyRpcClientConstructor<MarketServiceClientInstance>(async () => {
  const module = await import('@/generated/client/eagleeye/market/v1/service_client');
  return module.MarketServiceClient;
});

export const MilitaryServiceClient = createLazyRpcClientConstructor<MilitaryServiceClientInstance>(async () => {
  const module = await import('@/generated/client/eagleeye/military/v1/service_client');
  return module.MilitaryServiceClient;
});

export const NaturalServiceClient = createLazyRpcClientConstructor<NaturalServiceClientInstance>(async () => {
  const module = await import('@/generated/client/eagleeye/natural/v1/service_client');
  return module.NaturalServiceClient;
});

export const NewsServiceClient = createLazyRpcClientConstructor<NewsServiceClientInstance>(async () => {
  const module = await import('@/generated/client/eagleeye/news/v1/service_client');
  return module.NewsServiceClient;
});

export const PositiveEventsServiceClient = createLazyRpcClientConstructor<PositiveEventsServiceClientInstance>(async () => {
  const module = await import('@/generated/client/eagleeye/positive_events/v1/service_client');
  return module.PositiveEventsServiceClient;
});

export const PredictionServiceClient = createLazyRpcClientConstructor<PredictionServiceClientInstance>(async () => {
  const module = await import('@/generated/client/eagleeye/prediction/v1/service_client');
  return module.PredictionServiceClient;
});

export const RadiationServiceClient = createLazyRpcClientConstructor<RadiationServiceClientInstance>(async () => {
  const module = await import('@/generated/client/eagleeye/radiation/v1/service_client');
  return module.RadiationServiceClient;
});

export const ResearchServiceClient = createLazyRpcClientConstructor<ResearchServiceClientInstance>(async () => {
  const module = await import('@/generated/client/eagleeye/research/v1/service_client');
  return module.ResearchServiceClient;
});

export const ResilienceServiceClient = createLazyRpcClientConstructor<ResilienceServiceClientInstance>(async () => {
  const module = await import('@/generated/client/eagleeye/resilience/v1/service_client');
  return module.ResilienceServiceClient;
});

export const SanctionsServiceClient = createLazyRpcClientConstructor<SanctionsServiceClientInstance>(async () => {
  const module = await import('@/generated/client/eagleeye/sanctions/v1/service_client');
  return module.SanctionsServiceClient;
});

export const ScenarioServiceClient = createLazyRpcClientConstructor<ScenarioServiceClientInstance>(async () => {
  const module = await import('@/generated/client/eagleeye/scenario/v1/service_client');
  return module.ScenarioServiceClient;
});

export const SeismologyServiceClient = createLazyRpcClientConstructor<SeismologyServiceClientInstance>(async () => {
  const module = await import('@/generated/client/eagleeye/seismology/v1/service_client');
  return module.SeismologyServiceClient;
});

export const SupplyChainServiceClient = createLazyRpcClientConstructor<SupplyChainServiceClientInstance>(async () => {
  const module = await import('@/generated/client/eagleeye/supply_chain/v1/service_client');
  return module.SupplyChainServiceClient;
});

export const ThermalServiceClient = createLazyRpcClientConstructor<ThermalServiceClientInstance>(async () => {
  const module = await import('@/generated/client/eagleeye/thermal/v1/service_client');
  return module.ThermalServiceClient;
});

export const TradeServiceClient = createLazyRpcClientConstructor<TradeServiceClientInstance>(async () => {
  const module = await import('@/generated/client/eagleeye/trade/v1/service_client');
  return module.TradeServiceClient;
});

export const UnrestServiceClient = createLazyRpcClientConstructor<UnrestServiceClientInstance>(async () => {
  const module = await import('@/generated/client/eagleeye/unrest/v1/service_client');
  return module.UnrestServiceClient;
});

export const WebcamServiceClient = createLazyRpcClientConstructor<WebcamServiceClientInstance>(async () => {
  const module = await import('@/generated/client/eagleeye/webcam/v1/service_client');
  return module.WebcamServiceClient;
});

export const WildfireServiceClient = createLazyRpcClientConstructor<WildfireServiceClientInstance>(async () => {
  const module = await import('@/generated/client/eagleeye/wildfire/v1/service_client');
  return module.WildfireServiceClient;
});
