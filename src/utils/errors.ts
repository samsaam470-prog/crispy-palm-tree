/**
 * Domain errors thrown by services. The app-level error handler maps them
 * to consistent, safe JSON responses — internal details are never exposed.
 */

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export const badRequest = (message = 'The submitted data is invalid.', code = 'VALIDATION_ERROR') =>
  new ApiError(400, code, message);
export const unauthorized = (message = 'Authentication required.', code = 'UNAUTHENTICATED') =>
  new ApiError(401, code, message);
export const forbidden = (message = 'Not allowed.', code = 'FORBIDDEN') =>
  new ApiError(403, code, message);
export const notFound = (message = 'Resource not found.', code = 'NOT_FOUND') =>
  new ApiError(404, code, message);
export const conflict = (message = 'Operation conflicts with current state.', code = 'CONFLICT') =>
  new ApiError(409, code, message);
export const tooLarge = (message = 'Request body too large.', code = 'PAYLOAD_TOO_LARGE') =>
  new ApiError(413, code, message);
export const tooManyRequests = (message = 'Too many requests. Please slow down.', code = 'RATE_LIMITED') =>
  new ApiError(429, message);
