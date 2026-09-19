import type { Express } from "express";
import { requestOriginAllowed } from "../routes/same-origin-guard.js";
import type { SurvivingSession } from "../../common/survivingSessions.js";
import type { ReapSweepResult } from "../session/reap-idle-sessions.js";

// Deps injected from index.ts so the origin guard, session-id validation, and the
// orphan-selection boundary are unit-testable without booting the server (mirrors
// gitRemote / open-dir / command-summary).
export interface TmuxRouteDeps {
  isAllowedOrigin: (origin: string | undefined, remoteAddress: string | undefined) => boolean;
  isValidSessionId: (id: string) => boolean;
  // Reap a live session (kills its pty + tmux + cleanup); a no-op without a live entry.
  reapSession: (id: string) => void;
  hasTmux: (id: string) => boolean;
  killTmux: (id: string) => void;
  // Run the same sweep the server runs at boot, and say what it did. The route used to carry the
  // decision itself, against a predicate made of permanent records — which is why it reaped almost
  // nothing (#1467). One rule now, in session/reap-idle-sessions.ts.
  sweep: () => ReapSweepResult;
  // Every surviving tmux session, annotated for the Settings list (#1478). Injected like the rest,
  // so the route is testable without tmux, a registry or a clock.
  survivingSessions: () => Promise<SurvivingSession[]>;
  // The sweep cadence THIS process armed, which the saved config does not tell you: the timer is
  // armed once at boot and deliberately not re-armed on a POST (#2184). It rides on this response
  // rather than a route of its own because the list is what needs it — a row's promise depends on
  // whether a sweep is actually scheduled — and this section already fetches exactly this.
  armedReapIntervalHours: () => number;
}

export function mountTmuxRoutes(app: Express, deps: TmuxRouteDeps): void {
  // Explicit close (the cell's close button): reap NOW — kill the pty AND its tmux — instead of
  // leaving it for the disconnect grace. Works even when the WS is down, and kills a tmux
  // orphaned by a prior server restart (reap alone is a no-op without a live entry).
  //
  // `ended` is the POST-CONDITION, not "the request was accepted": both steps above can complete
  // without ending anything — `tmux kill-session` can fail — and a 200 that only means "asked" is
  // no use to the restart, which reconnects on the strength of this answer and would otherwise
  // ATTACH the very process it was asked to replace (CodeRabbit on #1920). One extra `has-session`
  // on a path taken once per close.
  app.post("/api/session/:id/terminate", (req, res) => {
    if (!requestOriginAllowed(req, deps.isAllowedOrigin)) return res.status(403).json({ error: "forbidden origin" });
    const id = req.params.id;
    if (!deps.isValidSessionId(id)) return res.status(400).json({ error: "invalid session id" });
    deps.reapSession(id); // live entry → kills pty + tmux + cleanup
    if (deps.hasTmux(id)) deps.killTmux(id); // orphan (e.g. post-restart) → kill directly
    return res.json({ ok: true, ended: !deps.hasTmux(id) });
  });

  // Every session that outlived the server, for the Settings list (#1478). A GET, and read-only:
  // what it shows is what the other two routes act on, which is why it is mounted beside them.
  //
  // The guard is asked exactly as its neighbours ask it, and — being a safe method — EXEMPT, the
  // same way google.ts's GET /status is (#1094): a cross-site `<img>` sends no Origin header and
  // neither does a legitimate local fetch, so refusing by origin would block the second without
  // stopping the first. What keeps this list private is that a cross-origin caller cannot READ the
  // reply; the rule lives in routes/same-origin-guard.ts.
  app.get("/api/tmux/sessions", async (req, res) => {
    if (!requestOriginAllowed(req, deps.isAllowedOrigin)) return res.status(403).json({ error: "forbidden origin" });
    return res.json({ sessions: await deps.survivingSessions(), armedReapIntervalHours: deps.armedReapIntervalHours() });
  });

  // The same sweep on demand: end every session nothing is using — nobody attached, no pty of
  // ours, no output for the configured number of days. The server runs it at boot; this is the way
  // to run it without restarting.
  app.post("/api/tmux/cleanup-orphans", (req, res) => {
    if (!requestOriginAllowed(req, deps.isAllowedOrigin)) return res.status(403).json({ error: "forbidden origin" });
    const { reaped } = deps.sweep();
    // `killed` keeps its name: this route's answer is read by whatever anyone wired to it before.
    return res.json({ killed: reaped, killedCount: reaped.length });
  });
}
