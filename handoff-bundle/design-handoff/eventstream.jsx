/* global window */
// Synthetic event stream. Produces a realistic mix of file/tool/reasoning
// events for both teams, driving the arena's flash system.

(function(){
  // Event types mirror classifyEvent() in real app
  const EVENT_TYPES = [
    { type: 'REASONING',  flash: 'thinking', weight: 4 },
    { type: 'TOOL_CALL',  flash: 'power',    weight: 2 },
    { type: 'FILE_CREATE',flash: 'strike',   weight: 3 },
    { type: 'FILE_EDIT',  flash: 'strike',   weight: 2 },
    { type: 'HIT',        flash: 'hit',      weight: 1 }, // synthetic counter-hit for choreography
  ];

  function weightedPick(list) {
    const total = list.reduce((s, x) => s + x.weight, 0);
    let r = Math.random() * total;
    for (const x of list) { r -= x.weight; if (r <= 0) return x; }
    return list[0];
  }

  class EventStream {
    constructor(teamIds, durationMs = 30000) {
      this.teamIds = teamIds;
      this.durationMs = durationMs;
      this.events = this._generate();
    }

    _generate() {
      const out = [];
      let t = 600;
      while (t < this.durationMs - 1500) {
        const teamId = this.teamIds[Math.floor(Math.random() * this.teamIds.length)];
        // Bursty: 50% chance we stay on same team for 2-3 events
        const burst = 1 + Math.floor(Math.random() * 3);
        for (let i = 0; i < burst && t < this.durationMs - 1500; i++) {
          const pick = weightedPick(EVENT_TYPES);
          out.push({
            eventId: `ev_${out.length}`,
            type: pick.type,
            flash: pick.flash,
            teamId,
            t,
          });
          t += 300 + Math.random() * 800;
        }
        t += 200 + Math.random() * 500;
      }
      return out;
    }

    // Events up to time t (ms)
    eventsUpTo(t) {
      return this.events.filter(e => e.t <= t);
    }

    // Events in window [t - win, t]
    eventsInWindow(t, win) {
      return this.events.filter(e => e.t <= t && e.t > t - win);
    }

    total() { return this.events.length; }
  }

  window.EventStream = EventStream;
})();
