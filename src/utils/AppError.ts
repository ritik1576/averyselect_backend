export class AppError extends Error {
  public statusCode: number;
  public isOperational: boolean;

  constructor(message: string, statusCode: number) {
    super(message);
    this.statusCode = statusCode;
    this.isOperational = true; // Identifies errors we foresee (e.g. 404 Not Found, 400 Bad Request)

    // Captures the stack trace, keeping the constructor call out of it
    Error.captureStackTrace(this, this.constructor);
  }
}
