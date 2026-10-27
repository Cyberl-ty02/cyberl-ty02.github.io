export type CommentProviderName = "twikoo" | "disabled";

export interface TwikooConfig {
  envId: string | null;
  includeReply: boolean;
}

export interface CommentRuntimeConfig {
  provider: CommentProviderName;
  twikoo: TwikooConfig;
}

export interface CommentViewContext {
  container: HTMLElement | null;
  document: Document;
  path: string;
  pathname: string;
  signal: AbortSignal;
}

export interface PageViewContext {
  document: Document;
  path: string;
  signal: AbortSignal;
  viewId: number;
}

export interface CommentProvider {
  load(context: CommentViewContext): Promise<void>;
  dispose(): void;
}

export interface PageViewTracker {
  load(context: PageViewContext): Promise<void>;
  dispose(): void;
}

export interface CommentProviderModule {
  createCommentProvider(config: CommentRuntimeConfig): CommentProvider;
  createPageViewTracker(config: CommentRuntimeConfig): PageViewTracker;
}
