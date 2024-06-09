export class RiverEvents {
  /**
   * Creates a new River instance with an optional initial event map.
   * @param events - The initial event map. Defaults to an empty object.
   */
  constructor(events = {}) {
    this.events = events;
  }
  /**
   * Maps an event type to the event map and returns a new River instance with the updated event map.
   * @template K - The key of the event type.
   * @template E - The event type, which extends from an object that contains 'message' and 'error' properties (optional).
   * @param event_type - The event type key.
   * @param example_event - An optional example event to be added to the event map.
   * @returns A new River instance with the updated event map.
   */
  map_event(event_type, example_event) {
    if (example_event) {
      example_event.type = event_type;
    }
    this.events[event_type] = example_event;
    return new RiverEvents(
      this.events
    );
  }
  /**
   * Builds and returns the event map that has been constructed using the `map_event` method.
   * @returns {T} The built event map.
   */
  build() {
    return this.events;
  }
}
