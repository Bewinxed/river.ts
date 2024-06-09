export class RiverError extends Error {
  constructor(message) {
    super(message);
    this.name = "RiverStreamError";
  }
}
