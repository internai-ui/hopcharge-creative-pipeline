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
import { YouTubePublisher } from './youtube/publisher'
import { MetaAnalytics } from './meta/analytics'
import { MetaAdLibraryScraper } from './meta/ad-library'
import { GoogleTrendsFetcher } from './google-trends/fetcher'
import { HiggsfieldGenerator, HiggsfieldImageGenerator } from './higgsfield'
import { KlingGenerator } from './kling'
import { RunwayGenerator } from './runway'
import { ReplicateFluxGenerator } from './replicate'

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
    default:             return new VideoGeneratorStub()
  }
}

export function getImageGenerator(): ImageGeneratorPlugin {
  switch (env('IMAGE_GENERATOR')) {
    case 'higgsfield':   return new HiggsfieldImageGenerator()
    case 'replicate':    return new ReplicateFluxGenerator()
    default:              return new ImageGeneratorStub()
  }
}

export function getMetaPublisher(): PublisherPlugin {
  switch (env('PUBLISHER_META')) {
    case 'meta': return new MetaPublisher()
    default: return new PublisherStub('meta')
  }
}

export function getYouTubePublisher(): PublisherPlugin {
  switch (env('PUBLISHER_YOUTUBE')) {
    case 'youtube': return new YouTubePublisher()
    default: return new PublisherStub('youtube')
  }
}

// Route a post to the publisher for its platform. Used by the publish endpoint so
// a YouTube post goes to Google Ads and a Meta post goes to the Graph API.
export function getPublisher(platform: string): PublisherPlugin {
  return platform === 'youtube' ? getYouTubePublisher() : getMetaPublisher()
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
