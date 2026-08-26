export type HttpErrorCode =
  | 'INVALID_REQUEST'
  | 'TIMEOUT'
  | 'CONNECTION_FAILURE'
  | 'TLS_FAILURE'
  | 'REDIRECT_LIMIT_EXCEEDED'
  | 'UNSUPPORTED_PROTOCOL'
  | 'ABORTED';

export class HttpError extends Error {
  public readonly code: HttpErrorCode;
  public readonly url: string;

  public constructor(
    code: HttpErrorCode,
    message: string,
    url: string,
    cause?: unknown,
  ) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = 'HttpError';
    this.code = code;
    this.url = url;
  }
}
