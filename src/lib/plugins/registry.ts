import type {
  IdeaGeneratorPlugin,
  VideoGeneratorPlugin,
  ImageGeneratorPlugin,
  PublisherPlugin,
  AnalyticsPlugin,
  TrendDataPlugin,
  WebSearchPlugin,
  AdLibraryPlugin,
} from './interfaces'

import { IdeaGeneratorStub } from './stubs/idea-generator.stub'
import { VideoGeneratorStub } from './stubs/video-generator.stub'
import { ImageGeneratorStub } from './stubs/image-generator.stub'
import { PublisherStub } from './stubs/publisher.stub'
import { AnalyticsStub } from './stubs/analytics.stub'
import { TrendDataStub } from './stubs/trend-data.stub'
import { WebSearchStub } from './stubs/web-search.stub'
import { AdLibraryStub } from './stubs/ad-library.stub'

import { ClaudeIdeaGenerator } from './claude/idea-generator'
import { ClaudeWebSearch } from './claude/web-search'
import { MetaPublisher } from './meta/publisher'
import { MetaAnalytics } from './meta/analytics'
import { MetaAdLibraryScraper } from './meta/ad-library'
import { GoogleTrendsFetcher } from './google-trends/fetcher'
import { HiggsfieldGenerator, HiggsfieldImageGenerator } from './higgsfield'
import { KlingGenerator } from './kling'
import { RunwayGenerator } from './runway'
import { ReplicateFluxGenerator } from './replicate'
import { KlingBrowserGenerator } from './browser/kling'
import { VeoBrowserGenerator } from './browser/veo'
import { RunwayBrowserGenerator } from './browser/runway'
import { FluxBrowserGenerator } from './browser/flux'
import { FlyneBrowserGenerator } from './browser/flyne'

function env(key: string, fallback = 'stub'): string {
  return process.env[key] ?? fallback
}

export function getIdeaGenerator(): IdeaGeneratorPlugin {
  switch (env('IDEA_GENERATOR')) {
    case 'claude': return new ClaudeIdeaGenerator()
    default: return new IdeaGeneratorStub()
  }
}

export function getVideoGenerator(): VideoGeneratorPlugin {
  switch (env('VIDEO_GENERATOR')) {
    case 'higgsfield':   return new HiggsfieldGenerator()
    case 'kling':        return new KlingGenerator()
    case 'runway':       return new RunwayGenerator()
    case 'browser-kling':   return new KlingBrowserGenerator()
    case 'browser-veo':     return new VeoBrowserGenerator()
    case 'browser-runway':  return new RunwayBrowserGenerator()
    default:             return new VideoGeneratorStub()
  }
}

export function getImageGenerator(): ImageGeneratorPlugin {
  switch (env('IMAGE_GENERATOR')) {
    case 'higgsfield':   return new HiggsfieldImageGenerator()
    case 'replicate':    return new ReplicateFluxGenerator()
    case 'browser-flux':  return new FluxBrowserGenerator()
    case 'browser-flyne': return new FlyneBrowserGenerator()
    default:              return new ImageGeneratorStub()
  }
}

export function getMetaPublisher(): PublisherPlugin {
  switch (env('PUBLISHER_META')) {
    case 'meta': return new MetaPublisher()
    default: return new PublisherStub()
  }
}

export function getMetaAnalytics(): AnalyticsPlugin {
  switch (env('ANALYTICS_META')) {
    case 'meta': return new MetaAnalytics()
    default: return new AnalyticsStub()
  }
}

export function getTrendData(): TrendDataPlugin {
  switch (env('TREND_DATA')) {
    case 'google': return new GoogleTrendsFetcher()
    default: return new TrendDataStub()
  }
}

export function getWebSearch(): WebSearchPlugin {
  switch (env('WEB_SEARCH')) {
    case 'claude': return new ClaudeWebSearch()
    default: return new WebSearchStub()
  }
}

export function getAdLibrary(): AdLibraryPlugin {
  switch (env('AD_LIBRARY')) {
    case 'meta': return new MetaAdLibraryScraper()
    default: return new AdLibraryStub()
  }
}
