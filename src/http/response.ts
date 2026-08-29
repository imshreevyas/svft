export type HttpResponseHeaders = Readonly<Record<string, readonly string[]>>;

export interface HttpRedirect {
  readonly fromUrl: string;
  readonly toUrl: string;
  readonly statusCode: number;
}

export interface HttpResponse {
  readonly requestedUrl: string;
  readonly finalUrl: string;
  readonly statusCode: number;
  readonly statusMessage: string | undefined;
  readonly headers: HttpResponseHeaders;
  readonly body: string;
  readonly responseTime: number;
  readonly redirectChain: readonly HttpRedirect[];
  readonly requestFingerprint?: string;
  readonly responseFingerprint?: string;
}
