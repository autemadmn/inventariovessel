// Error con código HTTP: el manejador responde con su estado y su mensaje.
export class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}
