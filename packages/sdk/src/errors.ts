import type { SynchronityErrorResponse } from './types/amps.js';

// ─── Base ───────────────────────────────────────────────────────────────────────

export class SynchronityError extends Error {
  readonly code: string;
  readonly statusCode: number;
  readonly requestId: string | undefined;

  constructor(message: string, code: string, statusCode: number, requestId?: string) {
    super(message);
    this.name = 'SynchronityError';
    this.code = code;
    this.statusCode = statusCode;
    this.requestId = requestId;
    // Maintain proper prototype chain in transpiled output.
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

// ─── Typed subclasses ───────────────────────────────────────────────────────────

/** 401 — Missing or invalid Agent Identity Token. */
export class SynchronityAuthError extends SynchronityError {
  constructor(message: string, code: string, requestId?: string) {
    super(message, code, 401, requestId);
    this.name = 'SynchronityAuthError';
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/** 403 — AIT lacks the required scope. */
export class SynchronityForbiddenError extends SynchronityError {
  constructor(message: string, code: string, requestId?: string) {
    super(message, code, 403, requestId);
    this.name = 'SynchronityForbiddenError';
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/** 404 / 410 — Resource not found or gone. */
export class SynchronityNotFoundError extends SynchronityError {
  constructor(message: string, code: string, requestId?: string, statusCode = 404) {
    super(message, code, statusCode, requestId);
    this.name = 'SynchronityNotFoundError';
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/** 429 — Rate limit exceeded. */
export class SynchronityRateLimitError extends SynchronityError {
  readonly retryAfter: number;

  constructor(message: string, retryAfter: number, requestId?: string) {
    super(message, 'RATE_LIMIT_EXCEEDED', 429, requestId);
    this.name = 'SynchronityRateLimitError';
    this.retryAfter = retryAfter;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/** 400 — Malformed request or validation error. */
export class SynchronityValidationError extends SynchronityError {
  constructor(message: string, code: string, requestId?: string) {
    super(message, code, 400, requestId);
    this.name = 'SynchronityValidationError';
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/** 422 — Unprocessable entity (e.g. checkout failed). */
export class SynchronityUnprocessableError extends SynchronityError {
  constructor(message: string, code: string, requestId?: string) {
    super(message, code, 422, requestId);
    this.name = 'SynchronityUnprocessableError';
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/** 5xx — Unexpected server error. */
export class SynchronityServerError extends SynchronityError {
  constructor(message: string, code: string, statusCode: number, requestId?: string) {
    super(message, code, statusCode, requestId);
    this.name = 'SynchronityServerError';
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

// ─── Factory ─────────────────────────────────────────────────────────────────────

export function parseErrorResponse(
  status: number,
  body: any,
  requestId?: string,
  retryAfter?: number,
): SynchronityError {
  const errorObj = body && typeof body === 'object' ? body.error : null;
  const code = (errorObj && typeof errorObj === 'object' ? errorObj.code : null) 
    || (body && typeof body === 'object' ? body.code : null)
    || 'UNKNOWN_ERROR';
  const message = (errorObj && typeof errorObj === 'object' ? errorObj.message : null)
    || (body && typeof body === 'object' ? body.message : null)
    || (typeof errorObj === 'string' ? errorObj : null)
    || `HTTP ${status}: ${body && typeof body === 'object' ? JSON.stringify(body) : String(body)}`;

  switch (status) {
    case 400:
      return new SynchronityValidationError(message, code, requestId);
    case 401:
      return new SynchronityAuthError(message, code, requestId);
    case 403:
      return new SynchronityForbiddenError(message, code, requestId);
    case 404:
      return new SynchronityNotFoundError(message, code, requestId, 404);
    case 410:
      return new SynchronityNotFoundError(message, code, requestId, 410);
    case 422:
      return new SynchronityUnprocessableError(message, code, requestId);
    case 429:
      return new SynchronityRateLimitError(message, retryAfter ?? 60, requestId);
    default:
      return new SynchronityServerError(message, code, status, requestId);
  }
}
